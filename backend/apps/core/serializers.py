from copy import deepcopy
from datetime import timedelta

from django.contrib.auth import authenticate, get_user_model
from django.utils import timezone
from rest_framework import serializers
from rest_framework_simplejwt.tokens import RefreshToken

from .models import Alert, AuditLog, CalendarTask, CommunityChildcareWorker, Court, District, Intake, MoreInformationRequest, Notification, NotificationRule, Organization, PartnersInDistrict, Province, RelationshipType, UpdateRequest, UserProfile, Ward

User = get_user_model()


YES_VALUES = {"yes", "true", "1", "y"}
NO_VALUES = {"no", "false", "0", "n"}
CHILD_SAFETY_MOVE_OPTIONS = {"Yes", "No", "Not applicable"}


def yes_no_value(value):
    text = str(value or "").strip()
    normalized = text.lower()
    if normalized in YES_VALUES:
        return "Yes"
    if normalized in NO_VALUES:
        return "No"
    return text if text in {"Yes", "No"} else ""


def bool_from_yes_no(value):
    return yes_no_value(value) == "Yes"


def emergency_classification(emergency_value, danger_value):
    danger = bool_from_yes_no(danger_value)
    emergency = bool_from_yes_no(emergency_value) or danger
    if danger:
        return {
            "is_emergency": True,
            "is_immediate_danger": True,
            "priority_level": "Critical",
            "emergency_classification": "EMERGENCY_IMMEDIATE_DANGER",
            "emergency_reported": "Yes",
            "immediate_danger_reported": "Yes",
        }
    if emergency:
        return {
            "is_emergency": True,
            "is_immediate_danger": False,
            "priority_level": "Emergency",
            "emergency_classification": "EMERGENCY",
            "emergency_reported": "Yes",
            "immediate_danger_reported": "No",
        }
    return {
        "is_emergency": False,
        "is_immediate_danger": False,
        "priority_level": "Normal",
        "emergency_classification": "NON_EMERGENCY",
        "emergency_reported": "No",
        "immediate_danger_reported": "No",
    }


def merged_opening_summary(instance, attrs):
    current = deepcopy(getattr(instance, "opening_summary", {}) or {}) if instance else {}
    incoming = attrs.get("opening_summary")
    if incoming is None:
        return current
    if not isinstance(incoming, dict):
        raise serializers.ValidationError({"opening_summary": "Opening summary must be an object."})
    return {**current, **incoming}


def submitted_status(attrs, instance=None):
    status_value = attrs.get("status", getattr(instance, "status", ""))
    return status_value == Intake.Status.SUPERVISOR_REVIEW or bool(attrs.get("screening_completed_at"))


def apply_emergency_attrs(attrs, instance=None):
    opening = merged_opening_summary(instance, attrs)
    emergency_answer = yes_no_value(opening.get("emergency_reported"))
    danger_answer = yes_no_value(opening.get("immediate_danger_reported"))
    if not emergency_answer and instance:
        emergency_answer = "Yes" if instance.is_emergency else "No" if instance.pk else ""
    if not danger_answer and instance:
        danger_answer = "Yes" if instance.is_immediate_danger else "No" if instance.pk else ""

    if emergency_answer or danger_answer:
        flags = emergency_classification(emergency_answer, danger_answer)
        opening["emergency_reported"] = flags["emergency_reported"]
        opening["immediate_danger_reported"] = flags["immediate_danger_reported"]
        attrs["opening_summary"] = opening
        attrs["is_emergency"] = flags["is_emergency"]
        attrs["is_immediate_danger"] = flags["is_immediate_danger"]
        attrs["priority_level"] = flags["priority_level"]
        attrs["emergency_classification"] = flags["emergency_classification"]
        attrs["immediate_action_required"] = flags["is_emergency"]
        if flags["is_immediate_danger"]:
            attrs["risk_level"] = "Critical"
        elif flags["is_emergency"] and str(attrs.get("risk_level") or getattr(instance, "risk_level", "")).lower() in {"", "pending", "low"}:
            attrs["risk_level"] = "High"
    return attrs


def validate_emergency_submission(attrs, instance=None):
    if not submitted_status(attrs, instance):
        return
    opening = merged_opening_summary(instance, attrs)
    emergency_answer = yes_no_value(opening.get("emergency_reported"))
    danger_answer = yes_no_value(opening.get("immediate_danger_reported"))
    errors = {}
    if not emergency_answer:
        errors["opening_summary.emergency_reported"] = "Is this an emergency case? is required."
    if not danger_answer:
        errors["opening_summary.immediate_danger_reported"] = "Is the child in immediate danger? is required."
    flags = emergency_classification(emergency_answer, danger_answer) if emergency_answer or danger_answer else {}
    if flags.get("is_immediate_danger"):
        if not attrs.get("child_moved_to_safety", getattr(instance, "child_moved_to_safety", None)):
            errors["child_moved_to_safety"] = "Was the child moved to a place of safety? is required."
        moved = attrs.get("child_moved_to_safety", getattr(instance, "child_moved_to_safety", ""))
        if moved and moved not in CHILD_SAFETY_MOVE_OPTIONS:
            errors["child_moved_to_safety"] = "Select Yes, No, or Not applicable."
    if errors:
        raise serializers.ValidationError(errors)

PROTECTED_SOURCE_VIEW_ROLES = {
    UserProfile.Role.SYS_ADMIN,
    UserProfile.Role.DEPUTY_DIRECTOR,
    UserProfile.Role.DIRECTOR,
    UserProfile.Role.PROGRAMME_OFFICER,
    UserProfile.Role.PROVINCIAL_HEAD,
    UserProfile.Role.DISTRICT_HEAD,
}

PROTECTED_SOURCE_FIELDS = [
    "information_source_name",
    "information_source_surname",
    "information_source_first_names",
    "information_source_id_number",
    "information_source_sex",
    "information_source_contact",
    "information_source_email",
    "information_source_address",
    "information_source_relationship_to_child",
    "information_source_reporter_type",
    "information_source_other",
    "alternative_contact",
    "source_brief_description",
]

PROTECTED_INFORMANT_FIELDS = [
    "surname",
    "first_names",
    "id_number",
    "sex",
    "address",
    "relationship_to_child",
    "phone",
    "email",
    "organization",
    "reporter_type",
]


def can_view_protected_source(user):
    if not user or not user.is_authenticated:
        return False
    if getattr(user, "is_superuser", False):
        return True
    profile = getattr(user, "profile", None)
    return bool(profile and profile.active and profile.role in PROTECTED_SOURCE_VIEW_ROLES)


def should_mask_protected_source(serializer):
    request = serializer.context.get("request") if hasattr(serializer, "context") else None
    return not can_view_protected_source(getattr(request, "user", None))


def mask_fields(data, fields):
    for field in fields:
        if field in data and data.get(field):
            data[field] = "Protected"
    return data


def mask_alert_source_payload(data):
    if data.get("protect_source_identity"):
        mask_fields(data, PROTECTED_SOURCE_FIELDS)
    return data


def wants_confidentiality(value):
    return value is True or str(value or "").strip().lower() in {"yes", "true", "1"}


def mask_opening_informant(opening):
    informant = opening.get("informant")
    if isinstance(informant, dict) and wants_confidentiality(informant.get("confidentiality")):
        mask_fields(informant, PROTECTED_INFORMANT_FIELDS)
    if wants_confidentiality(opening.get("protect_source_identity")):
        mask_fields(opening, PROTECTED_INFORMANT_FIELDS)
    return opening


class HealthSerializer(serializers.Serializer):
    status = serializers.CharField()
    service = serializers.CharField()


class DistrictSerializer(serializers.ModelSerializer):
    province = serializers.IntegerField(source="province_id", read_only=True)
    provinceName = serializers.CharField(source="province.name", read_only=True)
    createdByName = serializers.CharField(source="created_by.username", read_only=True)
    updatedByName = serializers.CharField(source="updated_by.username", read_only=True)

    class Meta:
        model = District
        fields = ["id", "name", "code", "province", "provinceName", "status", "createdByName", "updatedByName", "created_at", "updated_at"]


class DistrictWriteSerializer(serializers.ModelSerializer):
    class Meta:
        model = District
        fields = ["id", "province", "name", "code", "status"]

    def validate_code(self, value):
        code = (value or "").strip().upper()
        if len(code) != 3 or not code.isalpha():
            raise serializers.ValidationError("District code must be exactly 3 letters.")
        qs = District.objects.filter(code__iexact=code)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError("This district code is already in use.")
        return code


class ProvinceSerializer(serializers.ModelSerializer):
    createdByName = serializers.CharField(source="created_by.username", read_only=True)
    updatedByName = serializers.CharField(source="updated_by.username", read_only=True)

    class Meta:
        model = Province
        fields = ["id", "name", "code", "status", "createdByName", "updatedByName", "created_at", "updated_at"]


class RelationshipTypeSerializer(serializers.ModelSerializer):
    createdByName = serializers.CharField(source="created_by.username", read_only=True)
    updatedByName = serializers.CharField(source="updated_by.username", read_only=True)

    class Meta:
        model = RelationshipType
        fields = ["id", "name", "description", "status", "createdByName", "updatedByName", "created_at", "updated_at"]


class WardSerializer(serializers.ModelSerializer):
    province = serializers.IntegerField(source="province_id", read_only=True)
    provinceName = serializers.CharField(source="province.name", read_only=True)
    districtName = serializers.CharField(source="district.name", read_only=True)
    ward_name_or_number = serializers.CharField(source="name", required=False)
    createdByName = serializers.CharField(source="created_by.username", read_only=True)
    updatedByName = serializers.CharField(source="updated_by.username", read_only=True)

    class Meta:
        model = Ward
        fields = ["id", "province", "provinceName", "district", "districtName", "name", "ward_name_or_number", "description", "status", "createdByName", "updatedByName", "created_at", "updated_at"]
        validators = []

    def validate(self, attrs):
        district = attrs.get("district") or getattr(self.instance, "district", None)
        name = attrs.get("name") or getattr(self.instance, "name", "")
        if district:
            attrs["province"] = district.province
        if district and name:
            existing = Ward.objects.filter(district=district, name__iexact=name)
            if self.instance:
                existing = existing.exclude(id=self.instance.id)
            if existing.exists():
                raise serializers.ValidationError({"name": "This ward already exists in the selected district."})
        return attrs


class CommunityChildcareWorkerSerializer(serializers.ModelSerializer):
    province = serializers.IntegerField(source="province_id", read_only=True)
    provinceName = serializers.CharField(source="province.name", read_only=True)
    districtName = serializers.CharField(source="district.name", read_only=True)
    wardName = serializers.CharField(source="ward.name", read_only=True)
    userId = serializers.IntegerField(source="user_id", read_only=True)
    username = serializers.CharField(write_only=True, required=False, allow_blank=True)
    password = serializers.CharField(write_only=True, required=False, allow_blank=True, min_length=8)
    mustChangePassword = serializers.BooleanField(source="user.profile.must_change_password", read_only=True)
    createdByName = serializers.CharField(source="created_by.username", read_only=True)
    updatedByName = serializers.CharField(source="updated_by.username", read_only=True)

    class Meta:
        model = CommunityChildcareWorker
        fields = ["id", "userId", "username", "password", "mustChangePassword", "province", "provinceName", "district", "districtName", "ward", "wardName", "full_name", "national_id", "gender", "phone", "email", "physical_address", "status", "date_registered", "createdByName", "updatedByName", "created_at", "updated_at"]

    def validate(self, attrs):
        district = attrs.get("district") or getattr(self.instance, "district", None)
        ward = attrs.get("ward") or getattr(self.instance, "ward", None)
        username = attrs.get("username", "")
        password = attrs.get("password", "")
        if district:
            attrs["province"] = district.province
        if ward and district and ward.district_id != district.id:
            raise serializers.ValidationError({"ward": "Ward must belong to the selected district."})
        if not self.instance and not username:
            raise serializers.ValidationError({"username": "Username is required for CCW portal access."})
        if not self.instance and not password:
            raise serializers.ValidationError({"password": "Temporary password is required for CCW portal access."})
        if username:
            users = User.objects.filter(username=username)
            if self.instance and self.instance.user_id:
                users = users.exclude(id=self.instance.user_id)
            if users.exists():
                raise serializers.ValidationError({"username": "This username is already in use."})
        return attrs

    def _name_parts(self, full_name):
        parts = (full_name or "").strip().split()
        if not parts:
            return "", ""
        return parts[0], " ".join(parts[1:])

    def _sync_user(self, user, instance, password=""):
        first_name, last_name = self._name_parts(instance.full_name)
        user.first_name = first_name
        user.last_name = last_name
        user.email = instance.email or ""
        user.is_active = instance.status == "Active"
        if password:
            user.set_password(password)
        user.save()
        profile, _ = UserProfile.objects.get_or_create(user=user)
        profile.role = UserProfile.Role.CCW
        profile.phone = instance.phone
        profile.province = instance.province
        profile.district = instance.district
        profile.ward = instance.ward
        profile.active = instance.status == "Active"
        if password:
            profile.must_change_password = True
        profile.save()

    def create(self, validated_data):
        username = validated_data.pop("username", "").strip()
        password = validated_data.pop("password", "")
        instance = super().create(validated_data)
        first_name, last_name = self._name_parts(instance.full_name)
        user = User.objects.create_user(username=username, password=password, first_name=first_name, last_name=last_name, email=instance.email or "", is_active=instance.status == "Active")
        UserProfile.objects.create(user=user, role=UserProfile.Role.CCW, phone=instance.phone, province=instance.province, district=instance.district, ward=instance.ward, active=instance.status == "Active", must_change_password=True)
        instance.user = user
        instance.save(update_fields=["user"])
        return instance

    def update(self, instance, validated_data):
        username = validated_data.pop("username", "").strip()
        password = validated_data.pop("password", "")
        instance = super().update(instance, validated_data)
        if instance.user:
            if username:
                instance.user.username = username
            self._sync_user(instance.user, instance, password)
        elif username:
            first_name, last_name = self._name_parts(instance.full_name)
            user = User.objects.create_user(username=username, password=password, first_name=first_name, last_name=last_name, email=instance.email or "", is_active=instance.status == "Active")
            UserProfile.objects.create(user=user, role=UserProfile.Role.CCW, phone=instance.phone, province=instance.province, district=instance.district, ward=instance.ward, active=instance.status == "Active", must_change_password=True)
            instance.user = user
            instance.save(update_fields=["user"])
        return instance

    def to_representation(self, instance):
        data = super().to_representation(instance)
        data["username"] = instance.user.username if instance.user_id else ""
        return data


class PartnersInDistrictSerializer(serializers.ModelSerializer):
    province = serializers.IntegerField(source="province_id", read_only=True)
    provinceName = serializers.CharField(source="province.name", read_only=True)
    districtName = serializers.CharField(source="district.name", read_only=True)
    createdByName = serializers.CharField(source="created_by.username", read_only=True)
    updatedByName = serializers.CharField(source="updated_by.username", read_only=True)

    class Meta:
        model = PartnersInDistrict
        fields = ["id", "province", "provinceName", "district", "districtName", "partner_name", "partner_type", "partner_type_other", "services_offered", "services_offered_other", "contact_person", "phone", "email", "address", "operating_area", "status", "createdByName", "updatedByName", "created_at", "updated_at"]

    def validate(self, attrs):
        district = attrs.get("district") or getattr(self.instance, "district", None)
        partner_type = attrs.get("partner_type", getattr(self.instance, "partner_type", "") if self.instance else "")
        services_offered = attrs.get("services_offered", getattr(self.instance, "services_offered", []) if self.instance else [])
        phone = attrs.get("phone", getattr(self.instance, "phone", "") if self.instance else "")
        email = attrs.get("email", getattr(self.instance, "email", "") if self.instance else "")
        if district:
            attrs["province"] = district.province
        attrs["ward"] = None
        if partner_type != "Other":
            attrs["partner_type_other"] = ""
        if "Other" not in services_offered:
            attrs["services_offered_other"] = ""
        if not phone and not email:
            raise serializers.ValidationError("Phone or email is required.")
        return attrs


class CourtSerializer(serializers.ModelSerializer):
    province = serializers.IntegerField(source="province_id", read_only=True)
    provinceName = serializers.CharField(source="province.name", read_only=True)
    districtName = serializers.CharField(source="district.name", read_only=True)
    createdByName = serializers.CharField(source="created_by.username", read_only=True)
    updatedByName = serializers.CharField(source="updated_by.username", read_only=True)

    class Meta:
        model = Court
        fields = ["id", "province", "provinceName", "district", "districtName", "court_name", "court_type", "court_type_other", "contact_person", "phone", "email", "physical_address", "status", "createdByName", "updatedByName", "created_at", "updated_at"]

    def validate(self, attrs):
        district = attrs.get("district") or getattr(self.instance, "district", None)
        court_type = attrs.get("court_type", getattr(self.instance, "court_type", "") if self.instance else "")
        if district:
            attrs["province"] = district.province
        if court_type != "Other":
            attrs["court_type_other"] = ""
        return attrs


class OrganizationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Organization
        fields = ["id", "name", "organization_type", "district"]


class UserProfileSerializer(serializers.ModelSerializer):
    roleLabel = serializers.CharField(source="get_role_display", read_only=True)
    portal = serializers.CharField(read_only=True)
    organizationName = serializers.CharField(source="organization.name", read_only=True)
    provinceName = serializers.CharField(source="province.name", read_only=True)
    districtName = serializers.CharField(source="district.name", read_only=True)
    wardName = serializers.CharField(source="ward.name", read_only=True)

    class Meta:
        model = UserProfile
        fields = ["role", "roleLabel", "portal", "phone", "organization", "organizationName", "province", "provinceName", "district", "districtName", "ward", "wardName", "active", "must_change_password"]
        read_only_fields = ["must_change_password"]

    def validate_role(self, value):
        allowed_roles = {
            UserProfile.Role.SYS_ADMIN,
            UserProfile.Role.DEPUTY_DIRECTOR,
            UserProfile.Role.DIRECTOR,
            UserProfile.Role.PROGRAMME_OFFICER,
            UserProfile.Role.PROVINCIAL_HEAD,
            UserProfile.Role.DISTRICT_HEAD,
            UserProfile.Role.DSDO,
            UserProfile.Role.CCW,
        }
        if value not in allowed_roles:
            raise serializers.ValidationError("This role is no longer available.")
        return value

    def validate(self, attrs):
        role = attrs.get("role") or getattr(self.instance, "role", "")
        district = attrs.get("district") if "district" in attrs else getattr(self.instance, "district", None)
        province = attrs.get("province") if "province" in attrs else getattr(self.instance, "province", None)
        if role in {UserProfile.Role.DISTRICT_HEAD, UserProfile.Role.DSDO, UserProfile.Role.CCW} and not district:
            raise serializers.ValidationError({"district": "District is required for this role."})
        if role == UserProfile.Role.PROVINCIAL_HEAD and not province:
            raise serializers.ValidationError({"province": "Province is required for this role."})
        return attrs


class UserSerializer(serializers.ModelSerializer):
    profile = UserProfileSerializer()
    password = serializers.CharField(write_only=True, required=False, allow_blank=True)

    class Meta:
        model = User
        fields = ["id", "username", "first_name", "last_name", "email", "password", "is_active", "profile"]

    def create(self, validated_data):
        profile_data = validated_data.pop("profile")
        password = validated_data.pop("password", "")
        if not password:
            raise serializers.ValidationError({"password": "Password is required when creating a user."})
        if profile_data.get("role") == UserProfile.Role.SYS_ADMIN:
            validated_data["is_staff"] = True
            validated_data["is_superuser"] = True
        user = User.objects.create_user(password=password, **validated_data)
        UserProfile.objects.create(user=user, must_change_password=True, **profile_data)
        return user

    def update(self, instance, validated_data):
        profile_data = validated_data.pop("profile", None)
        password = validated_data.pop("password", None)
        for key, value in validated_data.items():
            setattr(instance, key, value)
        if password:
            instance.set_password(password)
        instance.save()
        if profile_data:
            profile, _ = UserProfile.objects.get_or_create(user=instance)
            for key, value in profile_data.items():
                setattr(profile, key, value)
            profile.save()
            if profile.role == UserProfile.Role.SYS_ADMIN:
                instance.is_staff = True
                instance.is_superuser = True
                instance.save(update_fields=["is_staff", "is_superuser"])
        if password and hasattr(instance, "profile"):
            instance.profile.must_change_password = True
            instance.profile.save(update_fields=["must_change_password"])
        return instance


class LoginSerializer(serializers.Serializer):
    username = serializers.CharField()
    password = serializers.CharField()
    portal = serializers.ChoiceField(choices=["external", "internal"])

    def validate(self, attrs):
        user = authenticate(username=attrs["username"], password=attrs["password"])
        if not user:
            raise serializers.ValidationError("Invalid username or password.")
        if not user.is_active or not getattr(user, "profile", None) or not user.profile.active:
            raise serializers.ValidationError("User is inactive.")
        if user.profile.portal != attrs["portal"]:
            raise serializers.ValidationError("This user is not allowed to access this portal.")
        if user.profile.must_change_password:
            attrs["password_change_required"] = True
            attrs["user"] = UserSerializer(user).data
            return attrs
        refresh = RefreshToken.for_user(user)
        attrs["access"] = str(refresh.access_token)
        attrs["refresh"] = str(refresh)
        attrs["user"] = UserSerializer(user).data
        return attrs


class ChangePasswordSerializer(serializers.Serializer):
    username = serializers.CharField()
    current_password = serializers.CharField()
    new_password = serializers.CharField(min_length=8)
    confirm_password = serializers.CharField()
    portal = serializers.ChoiceField(choices=["external", "internal"])

    def validate(self, attrs):
        if attrs["new_password"] != attrs["confirm_password"]:
            raise serializers.ValidationError("New password and confirm password do not match.")
        user = authenticate(username=attrs["username"], password=attrs["current_password"])
        if not user:
            raise serializers.ValidationError("Invalid username or temporary password.")
        if not user.is_active or not getattr(user, "profile", None) or not user.profile.active:
            raise serializers.ValidationError("User is inactive.")
        if user.profile.portal != attrs["portal"]:
            raise serializers.ValidationError("This user is not allowed to access this portal.")
        attrs["user"] = user
        return attrs

    def save(self):
        user = self.validated_data["user"]
        user.set_password(self.validated_data["new_password"])
        user.save(update_fields=["password"])
        user.profile.must_change_password = False
        user.profile.save(update_fields=["must_change_password"])
        refresh = RefreshToken.for_user(user)
        return {
            "access": str(refresh.access_token),
            "refresh": str(refresh),
            "user": UserSerializer(user).data,
        }


class AlertSerializer(serializers.ModelSerializer):
    id = serializers.CharField(source="reference", read_only=True)
    childName = serializers.CharField(source="child_display_name", read_only=True)
    age = serializers.CharField(source="estimated_age", required=False, allow_blank=True)
    districtName = serializers.CharField(source="district.name", read_only=True)
    wardName = serializers.CharField(source="ward.name", read_only=True)
    reporterName = serializers.SerializerMethodField()
    reporterType = serializers.SerializerMethodField()
    concern = serializers.SerializerMethodField()
    danger = serializers.SerializerMethodField()
    submittedAt = serializers.DateTimeField(source="created_at", format="%Y-%m-%d %H:%M", read_only=True)
    internalStatus = serializers.CharField(source="internal_status", read_only=True)
    intakeOfficer = serializers.SerializerMethodField()
    caseCategory = serializers.SerializerMethodField()
    riskLevel = serializers.SerializerMethodField()
    actionPlan = serializers.SerializerMethodField()
    allocatedOfficer = serializers.SerializerMethodField()

    class Meta:
        model = Alert
        fields = [
            "id",
            "childName",
            "child_first_name",
            "child_surname",
            "child_alias",
            "sex",
            "age",
            "date_of_birth",
            "birth_certificate_number",
            "birth_registered",
            "disability",
            "home_address",
            "district",
            "districtName",
            "ward",
            "wardName",
            "village_suburb",
            "chief_name",
            "nearest_landmark",
            "nearest_school",
            "nearest_clinic",
            "caregiver_name",
            "caregiver_contact",
            "relationship_to_child",
            "protect_reporter_identity",
            "intake_source",
            "reporting_channel",
            "information_source_type",
            "information_source_other",
            "information_source_name",
            "information_source_surname",
            "information_source_first_names",
            "information_source_id_number",
            "information_source_sex",
            "information_source_contact",
            "information_source_email",
            "information_source_address",
            "information_source_relationship_to_child",
            "information_source_reporter_type",
            "protect_source_identity",
            "alternative_contact",
            "source_brief_description",
            "concern_categories",
            "incident_date",
            "date_reporter_became_aware",
            "incident_location",
            "description",
            "alleged_perpetrator_name",
            "alleged_perpetrator_relationship",
            "alleged_perpetrator_known",
            "alleged_perpetrator_sex",
            "alleged_perpetrator_race",
            "alleged_perpetrator_address",
            "perpetrator_has_access",
            "referred_to_police",
            "police_reference_number",
            "police_referral_date",
            "court_appearance_scheduled",
            "court_appearance_date",
            "conviction_determined",
            "conviction_date",
            "status",
            "internalStatus",
            "emergency",
            "is_emergency",
            "is_immediate_danger",
            "priority_level",
            "emergency_classification",
            "child_moved_to_safety",
            "validity_decision",
            "invalid_reason",
            "reporterName",
            "reporterType",
            "concern",
            "danger",
            "submittedAt",
            "intakeOfficer",
            "caseCategory",
            "riskLevel",
            "actionPlan",
            "allocatedOfficer",
        ]

    def get_reporterName(self, obj):
        return obj.reporter.get_full_name() or obj.reporter.username

    def get_reporterType(self, obj):
        return obj.reporter.profile.get_role_display() if hasattr(obj.reporter, "profile") else "Reporter"

    def get_concern(self, obj):
        return ", ".join(obj.concern_categories) if obj.concern_categories else "Uncategorized"

    def get_danger(self, obj):
        return ["Immediate danger reported"] if getattr(obj, "is_immediate_danger", False) else []

    def get_intakeOfficer(self, obj):
        if obj.assigned_intake_officer:
            return obj.assigned_intake_officer.get_full_name() or obj.assigned_intake_officer.username
        return ""

    def get_caseCategory(self, obj):
        return getattr(getattr(obj, "intake", None), "case_category", "") or "Uncategorized"

    def get_riskLevel(self, obj):
        return getattr(getattr(obj, "intake", None), "risk_level", "") or ("High" if obj.emergency else "Pending")

    def get_actionPlan(self, obj):
        return getattr(getattr(obj, "intake", None), "immediate_action_plan", "")

    def get_allocatedOfficer(self, obj):
        intake = getattr(obj, "intake", None)
        if intake and intake.allocated_officer:
            return intake.allocated_officer.get_full_name() or intake.allocated_officer.username
        return ""

    def to_representation(self, instance):
        data = super().to_representation(instance)
        if instance.protect_source_identity and should_mask_protected_source(self):
            mask_alert_source_payload(data)
        return data

    def validate(self, attrs):
        attrs = super().validate(attrs)
        if attrs.get("alleged_perpetrator_known") != "Yes":
            attrs["alleged_perpetrator_name"] = ""
            attrs["alleged_perpetrator_relationship"] = ""
            attrs["alleged_perpetrator_sex"] = ""
            attrs["alleged_perpetrator_race"] = ""
            attrs["alleged_perpetrator_address"] = ""
            attrs["perpetrator_has_access"] = ""
        if attrs.get("referred_to_police") != "Yes":
            attrs["police_reference_number"] = ""
            attrs["police_referral_date"] = None
        emergency_answer = yes_no_value(attrs.get("is_emergency")) or yes_no_value(attrs.get("emergency"))
        danger_answer = yes_no_value(attrs.get("is_immediate_danger"))
        if emergency_answer or danger_answer:
            flags = emergency_classification(emergency_answer, danger_answer)
            attrs.update({key: flags[key] for key in ["is_emergency", "is_immediate_danger", "priority_level", "emergency_classification"]})
            attrs["emergency"] = flags["is_emergency"]
        return attrs

    def create(self, validated_data):
        user = self.context["request"].user
        concern_categories = validated_data.get("concern_categories", [])
        urgent_concerns = {"Sexual abuse", "Physical abuse", "Child abandonment", "Child trafficking", "Child living/working on streets", "Medical support needed", "Food insecurity"}
        inferred_emergency = bool(set(concern_categories).intersection(urgent_concerns))
        if not validated_data.get("is_emergency") and inferred_emergency:
            flags = emergency_classification("Yes", "No")
            validated_data.update({key: flags[key] for key in ["is_emergency", "is_immediate_danger", "priority_level", "emergency_classification"]})
        emergency = bool(validated_data.get("is_emergency"))
        validated_data["reporter"] = user
        validated_data["emergency"] = emergency
        validated_data["status"] = Alert.Status.EMERGENCY if emergency else Alert.Status.SUBMITTED
        validated_data["internal_status"] = "Immediate Action Required" if validated_data.get("is_immediate_danger") else "Emergency Case" if emergency else "Alert Submitted"
        alert = super().create(validated_data)
        AuditLog.objects.create(actor=user, action="Alert submitted", target_type="Alert", target_reference=alert.reference)
        return alert


class IntakeSerializer(serializers.ModelSerializer):
    alertReference = serializers.CharField(source="alert.reference", read_only=True, allow_null=True)
    allocatedOfficerName = serializers.SerializerMethodField()
    reviewedByName = serializers.SerializerMethodField()
    allocatedByName = serializers.SerializerMethodField()
    assessmentCompletedByName = serializers.SerializerMethodField()
    allocationDelaySeconds = serializers.SerializerMethodField()
    allocationDelayStatus = serializers.SerializerMethodField()
    assessment_started_at = serializers.SerializerMethodField()
    assessment_due_at = serializers.SerializerMethodField()
    assessmentRemainingSeconds = serializers.SerializerMethodField()
    assessmentSlaStatus = serializers.SerializerMethodField()
    case_review_due_at = serializers.SerializerMethodField()
    caseReviewStatus = serializers.SerializerMethodField()

    class Meta:
        model = Intake
        fields = [
            "id",
            "alert",
            "alertReference",
            "temporary_case_reference",
            "intake_source",
            "original_alert_snapshot",
            "opening_summary",
            "child_profile_draft",
            "household_profile_draft",
            "background_information",
            "prior_assistance",
            "duplicate_result",
            "initial_screening_notes",
            "screening_completed_at",
            "case_category",
            "risk_level",
            "immediate_action_required",
            "immediate_action_plan",
            "is_emergency",
            "is_immediate_danger",
            "priority_level",
            "emergency_classification",
            "child_moved_to_safety",
            "emergency_change_reason",
            "supervisor_notes",
            "reviewed_by",
            "reviewedByName",
            "reviewed_at",
            "allocated_by",
            "allocatedByName",
            "allocated_at",
            "allocated_officer",
            "allocatedOfficerName",
            "assessment_draft",
            "care_plan_draft",
            "care_plan_versions_draft",
            "care_plan_change_logs_draft",
            "case_conferences_draft",
            "justice_draft",
            "referrals_draft",
            "service_tracking_draft",
            "case_notes_draft",
            "case_documents_draft",
            "monitoring_followups_draft",
            "case_reviews_draft",
            "assessment_started_at",
            "assessment_due_at",
            "assessment_completed_at",
            "assessment_completed_by",
            "assessmentCompletedByName",
            "assessmentRemainingSeconds",
            "assessmentSlaStatus",
            "assessment_care_plan_status",
            "assessment_care_plan_submitted_at",
            "assessment_care_plan_submitted_by",
            "assessment_care_plan_reviewed_at",
            "assessment_care_plan_reviewed_by",
            "assessment_care_plan_review_notes",
            "last_case_review_at",
            "last_case_review_by",
            "last_case_review_decision",
            "last_case_review_notes",
            "case_review_due_at",
            "caseReviewStatus",
            "closure_status",
            "closure_draft",
            "closure_history_draft",
            "closure_requested_at",
            "closure_requested_by",
            "closure_reviewed_at",
            "closure_reviewed_by",
            "closure_review_notes",
            "allocationDelaySeconds",
            "allocationDelayStatus",
            "status",
            "created_at",
        ]
        read_only_fields = [
            "temporary_case_reference", "created_at", "reviewed_by", "reviewed_at", "allocated_by", "allocated_at",
            "assessment_completed_by", "assessment_completed_at", "assessment_care_plan_submitted_by",
            "assessment_care_plan_submitted_at", "assessment_care_plan_reviewed_by", "assessment_care_plan_reviewed_at",
            "last_case_review_by", "last_case_review_at", "closure_requested_by", "closure_requested_at",
            "closure_reviewed_by", "closure_reviewed_at",
        ]

    def get_allocatedOfficerName(self, obj):
        if obj.allocated_officer:
            return obj.allocated_officer.get_full_name() or obj.allocated_officer.username
        return ""

    def get_reviewedByName(self, obj):
        if obj.reviewed_by:
            return obj.reviewed_by.get_full_name() or obj.reviewed_by.username
        return ""

    def get_allocatedByName(self, obj):
        if obj.allocated_by:
            return obj.allocated_by.get_full_name() or obj.allocated_by.username
        return ""

    def get_assessmentCompletedByName(self, obj):
        if obj.assessment_completed_by:
            return obj.assessment_completed_by.get_full_name() or obj.assessment_completed_by.username
        return ""

    def get_allocationDelaySeconds(self, obj):
        if not obj.screening_completed_at or not obj.allocated_at:
            return None
        return max(0, int((obj.allocated_at - obj.screening_completed_at).total_seconds()))

    def get_allocationDelayStatus(self, obj):
        if not obj.screening_completed_at:
            return "Not started"
        if not obj.allocated_at:
            return "Awaiting allocation"
        delay = self.get_allocationDelaySeconds(obj) or 0
        if delay <= 4 * 3600:
            return "Allocated quickly"
        if delay <= 24 * 3600:
            return "Allocated same day"
        return "Allocation delayed"

    def get_assessment_started_at(self, obj):
        return obj.allocated_at

    def get_assessment_due_at(self, obj):
        if not obj.allocated_at:
            return None
        return obj.allocated_at + timedelta(days=7)

    def get_assessmentRemainingSeconds(self, obj):
        due_at = self.get_assessment_due_at(obj)
        if not due_at:
            return None
        end_at = obj.assessment_completed_at or timezone.now()
        return int((due_at - end_at).total_seconds())

    def get_assessmentSlaStatus(self, obj):
        if not obj.allocated_at:
            return "Not started"
        remaining = self.get_assessmentRemainingSeconds(obj)
        if remaining is None:
            return "Not started"
        if obj.assessment_completed_at:
            if remaining > 0:
                return "Completed early"
            if remaining == 0:
                return "Completed on time"
            return "Completed late"
        if remaining < 0:
            return "Overdue"
        if remaining <= 24 * 3600:
            return "Due soon"
        return "On time"

    def get_case_review_due_at(self, obj):
        anchor = obj.last_case_review_at or obj.assessment_care_plan_reviewed_at or obj.allocated_at
        if not anchor:
            return None
        return anchor + timedelta(days=20)

    def get_caseReviewStatus(self, obj):
        due_at = self.get_case_review_due_at(obj)
        if not due_at:
            return "Not started"
        if due_at < timezone.now():
            return "Review required"
        return "On track"

    def validate(self, attrs):
        child_profile = attrs.get("child_profile_draft")
        if child_profile is not None:
            if not isinstance(child_profile, dict):
                raise serializers.ValidationError({"child_profile_draft": "Child profile must be an object."})
            home_language = str(child_profile.get("home_language") or "").strip()
            religion = str(child_profile.get("religion") or "").strip()
            if home_language and home_language not in Intake.HOME_LANGUAGE_CHOICES:
                raise serializers.ValidationError({"child_profile_draft": {"home_language": f"Select one of: {', '.join(Intake.HOME_LANGUAGE_CHOICES)}."}})
            if religion and religion not in Intake.RELIGION_CHOICES:
                raise serializers.ValidationError({"child_profile_draft": {"religion": f"Select one of: {', '.join(Intake.RELIGION_CHOICES)}."}})

        opening_summary = attrs.get("opening_summary")
        if opening_summary is not None and not isinstance(opening_summary, dict):
            raise serializers.ValidationError({"opening_summary": "Opening summary must be an object."})
        attrs = apply_emergency_attrs(attrs, self.instance)
        validate_emergency_submission(attrs, self.instance)

        household_profile = attrs.get("household_profile_draft")
        if household_profile is not None:
            if not isinstance(household_profile, dict):
                raise serializers.ValidationError({"household_profile_draft": "Household profile must be an object."})
            family_members = household_profile.get("family_members", [])
            if family_members in (None, ""):
                family_members = []
            if not isinstance(family_members, list):
                raise serializers.ValidationError({"household_profile_draft": {"family_members": "Family members must be a list."}})
            for index, member in enumerate(family_members):
                if not isinstance(member, dict):
                    raise serializers.ValidationError({"household_profile_draft": {"family_members": f"Family member {index + 1} must be an object."}})
                category = str(member.get("person_category") or "").strip()
                first_names = str(member.get("first_names") or "").strip()
                surname = str(member.get("surname") or "").strip()
                status_value = str(member.get("living_involvement_status") or "").strip()
                if category and category not in Intake.FAMILY_PERSON_CATEGORIES:
                    raise serializers.ValidationError({"household_profile_draft": {"family_members": f"Family member {index + 1} has an invalid person category."}})
                if category in Intake.FAMILY_PERSON_CATEGORIES and (not first_names or not surname):
                    raise serializers.ValidationError({"household_profile_draft": {"family_members": f"First names and surname are required for family member {index + 1}."}})
                if status_value and status_value not in Intake.FAMILY_INVOLVEMENT_STATUSES:
                    raise serializers.ValidationError({"household_profile_draft": {"family_members": f"Family member {index + 1} has an invalid living / involvement status."}})
                if status_value == "Deceased" and not str(member.get("date_deceased") or "").strip():
                    raise serializers.ValidationError({"household_profile_draft": {"family_members": f"Date deceased is required for family member {index + 1}."}})
                if status_value == "Abandoned child" and not str(member.get("date_abandoned") or "").strip():
                    raise serializers.ValidationError({"household_profile_draft": {"family_members": f"Date abandoned is required for family member {index + 1}."}})
                dob_mode = str(member.get("dob_entry_mode") or "").strip()
                birth_value = str(member.get("date_of_birth") or "").strip()
                age_value = str(member.get("estimated_age") or member.get("dob_or_age") or "").strip()
                if age_value and not age_value.isdigit():
                    raise serializers.ValidationError({"household_profile_draft": {"family_members": f"Age must be numeric for family member {index + 1}."}})
                if dob_mode == "exact" and birth_value:
                    parts = birth_value.split("-")
                    if len(parts) != 3 or not all(part.isdigit() for part in parts):
                        raise serializers.ValidationError({"household_profile_draft": {"family_members": f"Use a full date of birth for family member {index + 1}."}})
                if dob_mode == "estimated" and birth_value:
                    parts = birth_value.split("-")
                    if len(parts) != 2 or not all(part.isdigit() for part in parts):
                        raise serializers.ValidationError({"household_profile_draft": {"family_members": f"Use month and year for estimated DOB on family member {index + 1}."}})

        prior_assistance = attrs.get("prior_assistance")
        if prior_assistance is not None:
            if not isinstance(prior_assistance, list):
                raise serializers.ValidationError({"prior_assistance": "Previous involvement records must be a list."})
            for index, record in enumerate(prior_assistance):
                if not isinstance(record, dict):
                    raise serializers.ValidationError({"prior_assistance": f"Previous involvement record {index + 1} must be an object."})
                category = str(record.get("institution_category") or "").strip()
                institution = str(record.get("institution_name") or "").strip()
                involvement_type = str(record.get("involvement_type") or "").strip()
                juvenile_offence_type = str(record.get("juvenile_offence_type") or "").strip()
                outcome = str(record.get("status") or "").strip()
                services = record.get("services", [])
                if category and category not in Intake.PREVIOUS_INVOLVEMENT_CATEGORIES:
                    raise serializers.ValidationError({"prior_assistance": f"Previous involvement record {index + 1} has an invalid institution category."})
                if category and (not institution or not involvement_type):
                    raise serializers.ValidationError({"prior_assistance": f"Institution / agency name and type of involvement are required for record {index + 1}."})
                if category != "Law Enforcement" or involvement_type != "Conflict with law":
                    record["juvenile_offence_type"] = ""
                elif juvenile_offence_type and juvenile_offence_type not in Intake.JUVENILE_OFFENCE_TYPES:
                    raise serializers.ValidationError({"prior_assistance": f"Previous involvement record {index + 1} has an invalid juvenile offence type."})
                if outcome and outcome not in Intake.PREVIOUS_INVOLVEMENT_OUTCOMES:
                    raise serializers.ValidationError({"prior_assistance": f"Previous involvement record {index + 1} has an invalid outcome / status."})
                if not isinstance(services, list):
                    raise serializers.ValidationError({"prior_assistance": f"Services received must be a list for record {index + 1}."})

        return attrs

    def update(self, instance, validated_data):
        old_flags = {
            "is_emergency": instance.is_emergency,
            "is_immediate_danger": instance.is_immediate_danger,
            "priority_level": instance.priority_level,
            "emergency_classification": instance.emergency_classification,
        }
        next_status = validated_data.get("status")
        if next_status == Intake.Status.SUPERVISOR_REVIEW and not instance.screening_completed_at:
            instance.screening_completed_at = timezone.now()
        updated = super().update(instance, validated_data)
        new_flags = {key: getattr(updated, key) for key in old_flags}
        if old_flags != new_flags:
            request = self.context.get("request")
            AuditLog.objects.create(
                actor=request.user if request and request.user.is_authenticated else None,
                action="Emergency safeguarding classification changed",
                target_type="Intake",
                target_reference=updated.temporary_case_reference,
                metadata={"previous": old_flags, "new": new_flags, "reason": updated.emergency_change_reason},
            )
        return updated

    def to_representation(self, instance):
        data = super().to_representation(instance)
        if not should_mask_protected_source(self):
            return data

        snapshot = deepcopy(data.get("original_alert_snapshot") or {})
        if snapshot.get("protect_source_identity"):
            data["original_alert_snapshot"] = mask_alert_source_payload(snapshot)

        opening = deepcopy(data.get("opening_summary") or {})
        data["opening_summary"] = mask_opening_informant(opening)
        return data


class MoreInformationRequestSerializer(serializers.ModelSerializer):
    class Meta:
        model = MoreInformationRequest
        fields = ["id", "alert", "message", "response", "resolved", "created_at", "responded_at"]
        read_only_fields = ["created_at", "responded_at"]


class UpdateRequestSerializer(serializers.ModelSerializer):
    caseReference = serializers.CharField(source="intake.temporary_case_reference", read_only=True)
    requestedByName = serializers.SerializerMethodField()
    reviewedByName = serializers.SerializerMethodField()

    class Meta:
        model = UpdateRequest
        fields = [
            "id",
            "intake",
            "caseReference",
            "tab",
            "requested_fields",
            "reason",
            "status",
            "requested_by",
            "requestedByName",
            "requested_at",
            "reviewed_by",
            "reviewedByName",
            "reviewed_at",
            "review_notes",
        ]
        read_only_fields = ["requested_by", "requested_at", "reviewed_by", "reviewed_at", "status"]

    def get_requestedByName(self, obj):
        return obj.requested_by.get_full_name() or obj.requested_by.username

    def get_reviewedByName(self, obj):
        if obj.reviewed_by:
            return obj.reviewed_by.get_full_name() or obj.reviewed_by.username
        return ""


class NotificationSerializer(serializers.ModelSerializer):
    targetType = serializers.CharField(source="target_type", read_only=True)
    targetId = serializers.CharField(source="target_id", read_only=True)
    actionLabel = serializers.CharField(source="action_label", read_only=True)
    createdAt = serializers.DateTimeField(source="created_at", read_only=True)
    dueAt = serializers.DateTimeField(source="due_at", read_only=True, allow_null=True)
    resolvedAt = serializers.DateTimeField(source="resolved_at", read_only=True, allow_null=True)
    unread = serializers.SerializerMethodField()

    class Meta:
        model = Notification
        fields = ["id", "title", "message", "category", "priority", "targetType", "targetId", "actionLabel", "route", "unread", "createdAt", "dueAt", "resolvedAt"]

    def get_unread(self, obj):
        return obj.read_at is None


class NotificationRuleSerializer(serializers.ModelSerializer):
    class Meta:
        model = NotificationRule
        fields = ["id", "trigger", "stage", "title_template", "message_template", "priority", "category", "recipient_roles", "escalation_roles", "offset_minutes", "enabled", "created_at", "updated_at"]
        read_only_fields = ["created_at", "updated_at"]


class AuditLogSerializer(serializers.ModelSerializer):
    actorName = serializers.SerializerMethodField()
    actorRole = serializers.SerializerMethodField()
    actorRoleLabel = serializers.SerializerMethodField()
    actorProvince = serializers.SerializerMethodField()
    actorDistrict = serializers.SerializerMethodField()

    class Meta:
        model = AuditLog
        fields = ["id", "actorName", "actorRole", "actorRoleLabel", "actorProvince", "actorDistrict", "action", "target_type", "target_reference", "metadata", "created_at"]

    def get_actorName(self, obj):
        if not obj.actor:
            return "System"
        return obj.actor.get_full_name() or obj.actor.username

    def get_actorRole(self, obj):
        return getattr(getattr(obj.actor, "profile", None), "role", "System")

    def get_actorRoleLabel(self, obj):
        profile = getattr(obj.actor, "profile", None)
        return profile.get_role_display() if profile else "System"

    def get_actorProvince(self, obj):
        province = getattr(getattr(obj.actor, "profile", None), "province", None)
        return province.name if province else ""

    def get_actorDistrict(self, obj):
        district = getattr(getattr(obj.actor, "profile", None), "district", None)
        return district.name if district else ""


class CalendarTaskSerializer(serializers.ModelSerializer):
    class Meta:
        model = CalendarTask
        fields = ["id", "title", "detail", "date", "urgent", "source", "created_at"]
        read_only_fields = ["created_at"]

    def create(self, validated_data):
        user = self.context["request"].user
        task, _ = CalendarTask.objects.update_or_create(
            source=validated_data.get("source", ""),
            title=validated_data["title"],
            date=validated_data["date"],
            defaults={
                "detail": validated_data.get("detail", ""),
                "urgent": validated_data.get("urgent", False),
                "created_by": user,
            },
        )
        return task
