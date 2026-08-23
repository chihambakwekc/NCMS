from copy import deepcopy
from datetime import timedelta

from django.contrib.auth import authenticate, get_user_model
from django.utils import timezone
from rest_framework import serializers
from rest_framework_simplejwt.tokens import RefreshToken

from .models import Alert, AuditLog, CalendarTask, CommunityChildcareWorker, Court, District, Intake, MoreInformationRequest, Notification, NotificationRule, Organization, PartnersInDistrict, Province, RelationshipType, ReportGeneration, UpdateRequest, UserProfile, Ward

User = get_user_model()


YES_VALUES = {"yes", "true", "1", "y"}
NO_VALUES = {"no", "false", "0", "n"}
CHILD_SAFETY_MOVE_OPTIONS = {"Yes", "No", "Not applicable"}
CHILD_LOCATION_FIELDS = ("district", "ward", "village", "chief_name", "nearest_landmark", "capture_latitude", "capture_longitude")
RETIRED_SCREENING_FIELDS = ("case_category_notes", "accused_address", "police_reference_number")
SAFEGUARDING_RULE_VERSION = "CASE-TYPE-RULES-1.0"

# The client currently stores the approved government labels.  Keeping their
# canonical codes here makes the rule stable when the UI moves to coded values.
CASE_TYPE_CODES = {
    "Sexual abuse": "SEXUAL_ABUSE", "Physical abuse": "PHYSICAL_ABUSE", "Emotional abuse": "EMOTIONAL_ABUSE", "Neglect": "NEGLECT",
    "Hazardous labour": "HAZARDOUS_LABOUR", "Hazardous Labour": "HAZARDOUS_LABOUR", "Sexual exploitation": "SEXUAL_EXPLOITATION", "Child trafficking": "CHILD_TRAFFICKING",
    "Foster care": "FOSTER_CARE_PROTECTION", "Institutionalized child": "INSTITUTIONALIZED_CHILD", "Child abandonment": "CHILD_ABANDONMENT",
    "Child being bullied": "CHILD_BEING_BULLIED", "Displaced child": "DISPLACED_CHILD", "Child living/working on streets": "CHILD_LIVING_WORKING_ON_STREETS",
    "Child smuggling": "CHILD_SMUGGLING", "Child Smuggling": "CHILD_SMUGGLING", "Unaccompanied child": "UNACCOMPANIED_CHILD",
    "Child in conflict with the law": "CHILD_IN_CONFLICT_WITH_THE_LAW", "Child in contact with the law custody": "CHILD_IN_CONTACT_WITH_THE_LAW_CUSTODY",
    "Child married before legal age": "CHILD_MARRIED_BEFORE_LEGAL_AGE", "Child with disability": "CHILD_WITH_DISABILITY", "Child living with HIV": "CHILD_LIVING_WITH_HIV",
    "Child in need of birth registration/certificates": "NEEDS_BIRTH_REGISTRATION", "Child in need of educational support": "NEEDS_EDUCATIONAL_SUPPORT",
    "Child in need of transport assistance (service access)": "NEEDS_TRANSPORT_ASSISTANCE", "Child in need of transport assistance": "NEEDS_TRANSPORT_ASSISTANCE",
    "Child is food insecure": "FOOD_INSECURE", "Child in need of medical support (e.g. in need of AMTO)": "CHILD_IN_NEED_OF_MEDICAL_SUPPORT",
    "Child in need of medical support": "CHILD_IN_NEED_OF_MEDICAL_SUPPORT", "Disabled child in need of devices": "DISABLED_CHILD_NEEDS_DEVICES",
    "Ministerial Order": "MINISTERIAL_ORDER", "Criminal Court Order": "CRIMINAL_COURT_ORDER", "Juvenile / Child Court Order": "JUVENILE_CHILD_COURT_ORDER",
    "Defacto Adoption": "DEFACTO_ADOPTION", "Non defacto adoption": "NON_DEFACTO_ADOPTION", "Foster Care": "FOSTER_CARE_COURT_ORDER",
}

JUVENILE_DELINQUENCY_OFFENCES = {
    "Assault", "Sexual Offence", "Injustice", "Malicious damage to property",
    "Theft", "Shoplifting", "Other property offence", "Smoking / sniffing",
    "Drug trafficking", "Forgery, fraud and theft by conversion",
    "Offence against state and public order", "Wildlife Act",
}
EMERGENCY_CASE_TYPES = {
    "SEXUAL_ABUSE", "PHYSICAL_ABUSE", "EMOTIONAL_ABUSE", "NEGLECT", "HAZARDOUS_LABOUR", "SEXUAL_EXPLOITATION", "CHILD_TRAFFICKING",
    "CHILD_ABANDONMENT", "CHILD_LIVING_WORKING_ON_STREETS", "CHILD_SMUGGLING", "UNACCOMPANIED_CHILD", "CHILD_IN_CONFLICT_WITH_THE_LAW",
    "CHILD_MARRIED_BEFORE_LEGAL_AGE", "CHILD_IN_NEED_OF_MEDICAL_SUPPORT", "CRIMINAL_COURT_ORDER", "JUVENILE_CHILD_COURT_ORDER",
}
NORMAL_CASE_TYPES = {
    "FOSTER_CARE_PROTECTION", "INSTITUTIONALIZED_CHILD", "DISPLACED_CHILD", "CHILD_BEING_BULLIED",
    "CHILD_IN_CONTACT_WITH_THE_LAW_CUSTODY", "CHILD_WITH_DISABILITY", "CHILD_LIVING_WITH_HIV",
    "NEEDS_BIRTH_REGISTRATION", "NEEDS_EDUCATIONAL_SUPPORT", "NEEDS_TRANSPORT_ASSISTANCE", "FOOD_INSECURE",
    "DISABLED_CHILD_NEEDS_DEVICES", "MINISTERIAL_ORDER", "DEFACTO_ADOPTION", "NON_DEFACTO_ADOPTION",
    "FOSTER_CARE_COURT_ORDER",
}


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


def calculate_safeguarding_classification(selected_case_types, existing_immediate_danger_flag):
    codes = [CASE_TYPE_CODES.get(str(item), str(item)) for item in (selected_case_types or [])]
    emergency_codes = [code for code in codes if code in EMERGENCY_CASE_TYPES]
    if existing_immediate_danger_flag:
        return "IMMEDIATE_DANGER", ["EXISTING_IMMEDIATE_DANGER", *emergency_codes]
    if emergency_codes:
        return "EMERGENCY", emergency_codes
    return "NORMAL", []


def merged_opening_summary(instance, attrs):
    current = deepcopy(getattr(instance, "opening_summary", {}) or {}) if instance else {}
    incoming = attrs.get("opening_summary")
    if incoming is None:
        return current
    if not isinstance(incoming, dict):
        raise serializers.ValidationError({"opening_summary": "Opening summary must be an object."})
    return {**current, **incoming}


def relocate_child_location_fields(attrs, instance=None):
    """Store child location information with the child profile, not the retired summary step."""
    opening = merged_opening_summary(instance, attrs)
    current_child = deepcopy(getattr(instance, "child_profile_draft", {}) or {}) if instance else {}
    incoming_child = attrs.get("child_profile_draft")
    if incoming_child is not None and not isinstance(incoming_child, dict):
        raise serializers.ValidationError({"child_profile_draft": "Child profile must be an object."})

    child_profile = {**current_child, **(incoming_child or {})}
    for field in CHILD_LOCATION_FIELDS:
        if field not in child_profile and field in opening:
            child_profile[field] = opening[field]
        opening.pop(field, None)

    if incoming_child is not None or any(field in child_profile for field in CHILD_LOCATION_FIELDS):
        attrs["child_profile_draft"] = child_profile
    if "opening_summary" in attrs or instance and any(field in getattr(instance, "opening_summary", {}) for field in CHILD_LOCATION_FIELDS):
        attrs["opening_summary"] = opening
    return attrs


def remove_retired_screening_fields(attrs, instance=None):
    """Prevent retired case fields from being restored through partial updates."""
    opening = merged_opening_summary(instance, attrs)
    screening = opening.get("screening_draft")
    if isinstance(screening, dict):
        screening = deepcopy(screening)
        for field in RETIRED_SCREENING_FIELDS:
            screening.pop(field, None)
        opening["screening_draft"] = screening
    if "opening_summary" in attrs or instance and isinstance(getattr(instance, "opening_summary", None), dict):
        attrs["opening_summary"] = opening
    return attrs


def submitted_status(attrs, instance=None):
    status_value = attrs.get("status", getattr(instance, "status", ""))
    return status_value == Intake.Status.SUPERVISOR_REVIEW or bool(attrs.get("screening_completed_at"))


def apply_emergency_attrs(attrs, instance=None):
    opening = merged_opening_summary(instance, attrs)
    danger_answer = yes_no_value(opening.get("immediate_danger_reported"))
    if not danger_answer and instance:
        danger_answer = "Yes" if instance.is_immediate_danger else "No" if instance.pk else ""
    screening = opening.get("screening_draft") if isinstance(opening.get("screening_draft"), dict) else {}
    selected_case_types = screening.get("selected_categories", [])
    juvenile_case_selected = any(item in {"Child in conflict with the law", "Child in contact with the law custody"} for item in selected_case_types)
    submitted_offences = screening.get("juvenile_offences") or []
    screening["juvenile_offences"] = [
        str(item).strip() for item in submitted_offences
        if str(item).strip() in JUVENILE_DELINQUENCY_OFFENCES
    ] if juvenile_case_selected and isinstance(submitted_offences, list) else []
    screening["juvenile_other_property_offence"] = (
        str(screening.get("juvenile_other_property_offence") or "").strip()
        if juvenile_case_selected and "Other property offence" in screening["juvenile_offences"] else ""
    )
    opening["screening_draft"] = screening
    classification, trigger_codes = calculate_safeguarding_classification(selected_case_types, danger_answer == "Yes")
    is_immediate_danger = classification == "IMMEDIATE_DANGER"
    is_emergency = classification in {"EMERGENCY", "IMMEDIATE_DANGER"}
    opening["emergency_reported"] = "Yes" if is_emergency else "No"
    opening["immediate_danger_reported"] = "Yes" if is_immediate_danger else "No"
    attrs["opening_summary"] = opening
    attrs["is_emergency"] = is_emergency
    attrs["is_immediate_danger"] = is_immediate_danger
    attrs["priority_level"] = "Critical" if is_immediate_danger else "Emergency" if is_emergency else "Normal"
    attrs["emergency_classification"] = "EMERGENCY_IMMEDIATE_DANGER" if is_immediate_danger else "EMERGENCY" if is_emergency else "NON_EMERGENCY"
    attrs["safeguarding_classification"] = classification
    attrs["classification_source"] = "SYSTEM"
    attrs["classification_rule_version"] = SAFEGUARDING_RULE_VERSION
    attrs["classification_trigger_codes"] = trigger_codes
    attrs["classification_calculated_at"] = timezone.now()
    if is_immediate_danger:
        attrs["risk_level"] = "Critical"
    elif is_emergency and str(attrs.get("risk_level") or getattr(instance, "risk_level", "")).lower() in {"", "pending", "low"}:
        attrs["risk_level"] = "High"
    return attrs


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
    "information_source_other",
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
        if len(code) != 2 or not code.isalpha():
            raise serializers.ValidationError("District code must be exactly 2 letters.")
        qs = District.objects.filter(code__iexact=code)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError("This district code is already in use.")
        return code

    def validate_name(self, value):
        name = (value or "").strip()
        if not name:
            raise serializers.ValidationError("District name is required.")
        return name

    def validate(self, attrs):
        attrs = super().validate(attrs)
        province = attrs.get("province") or getattr(self.instance, "province", None)
        name = attrs.get("name") or getattr(self.instance, "name", "")
        duplicates = District.objects.filter(province=province, name__iexact=name)
        if self.instance:
            duplicates = duplicates.exclude(pk=self.instance.pk)
        if duplicates.exists():
            raise serializers.ValidationError({"name": "District already exists for this province."})
        return attrs


class ProvinceSerializer(serializers.ModelSerializer):
    createdByName = serializers.CharField(source="created_by.username", read_only=True)
    updatedByName = serializers.CharField(source="updated_by.username", read_only=True)

    class Meta:
        model = Province
        fields = ["id", "name", "code", "status", "createdByName", "updatedByName", "created_at", "updated_at"]

    def validate_name(self, value):
        name = (value or "").strip()
        if not name:
            raise serializers.ValidationError("Province name is required.")
        duplicates = Province.objects.filter(name__iexact=name)
        if self.instance:
            duplicates = duplicates.exclude(pk=self.instance.pk)
        if duplicates.exists():
            raise serializers.ValidationError("Province already exists.")
        return name

    def validate_code(self, value):
        return (value or "").strip().upper()


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
    officerCode = serializers.CharField(source="officer_code", read_only=True)
    roleLabel = serializers.CharField(source="get_role_display", read_only=True)
    portal = serializers.CharField(read_only=True)
    organizationName = serializers.CharField(source="organization.name", read_only=True)
    provinceName = serializers.CharField(source="province.name", read_only=True)
    districtName = serializers.CharField(source="district.name", read_only=True)
    wardName = serializers.CharField(source="ward.name", read_only=True)

    class Meta:
        model = UserProfile
        fields = ["role", "roleLabel", "portal", "officerCode", "phone", "organization", "organizationName", "province", "provinceName", "district", "districtName", "ward", "wardName", "active", "must_change_password"]
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
            "perpetrator_has_access",
            "referred_to_police",
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
        extra_kwargs = {
            "information_source_address": {"required": False, "allow_blank": True},
        }

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
        return ""

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
            attrs["perpetrator_has_access"] = ""
        if attrs.get("referred_to_police") != "Yes":
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
        profile = getattr(user, "profile", None)
        if profile and profile.role == UserProfile.Role.CCW:
            if not profile.district_id or not profile.ward_id:
                raise serializers.ValidationError({"location": "Your public portal account must be assigned to a district and ward before you can submit an alert."})
            if profile.ward.district_id != profile.district_id:
                raise serializers.ValidationError({"location": "Your account's ward does not belong to its assigned district. Contact an administrator."})
            # Public portal accounts are location-scoped by the administrator.
            # Never accept location or reporting-channel values supplied by the browser.
            validated_data["district"] = profile.district
            validated_data["ward"] = profile.ward
            validated_data["reporting_channel"] = "Public portal"
            for field in [
                "caregiver_name", "caregiver_contact", "relationship_to_child", "incident_location",
                "perpetrator_has_access",
            ]:
                validated_data[field] = ""
            validated_data["incident_date"] = None
            validated_data["date_reporter_became_aware"] = None
            validated_data["birth_certificate_number"] = ""
            validated_data["protect_reporter_identity"] = False
            validated_data["protect_source_identity"] = False
            classification, _ = calculate_safeguarding_classification(validated_data.get("concern_categories", []), False)
            is_emergency = classification == "EMERGENCY"
            validated_data["is_emergency"] = is_emergency
            validated_data["is_immediate_danger"] = False
            validated_data["emergency"] = is_emergency
            validated_data["priority_level"] = "High" if is_emergency else "Normal"
            validated_data["emergency_classification"] = "EMERGENCY" if is_emergency else "NON_EMERGENCY"
            if "Sexual abuse" in validated_data.get("concern_categories", []):
                if not validated_data.get("alleged_perpetrator_known"):
                    raise serializers.ValidationError({"alleged_perpetrator_known": "Perpetrator known is required for the selected case type."})
                if validated_data.get("alleged_perpetrator_known") == "Yes" and not str(validated_data.get("alleged_perpetrator_name") or "").strip():
                    raise serializers.ValidationError({"alleged_perpetrator_name": "Accused name is required when perpetrator known is Yes."})
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
    districtName = serializers.SerializerMethodField()
    allocatedOfficerName = serializers.SerializerMethodField()
    reviewedByName = serializers.SerializerMethodField()
    allocatedByName = serializers.SerializerMethodField()
    allocationDelaySeconds = serializers.SerializerMethodField()
    allocationDelayStatus = serializers.SerializerMethodField()
    # Assessment timing is anchored to the recorded allocation.  These are
    # computed fields so existing allocated cases immediately expose the same
    # SLA without a data migration.
    assessment_started_at = serializers.SerializerMethodField()
    assessment_due_at = serializers.SerializerMethodField()
    assessmentRemainingSeconds = serializers.SerializerMethodField()
    assessmentSlaStatus = serializers.SerializerMethodField()

    class Meta:
        model = Intake
        fields = [
            "id",
            "alert",
            "alertReference",
            "districtName",
            "temporary_case_reference",
            "intake_source",
            "original_alert_snapshot",
            "opening_summary",
            "child_profile_draft",
            "referral_date",
            "case_referred_by",
            "alleged_perpetrators",
            "household_profile_draft",
            "background_information",
            "screening_completed_at",
            "case_category",
            "risk_level",
            "is_emergency",
            "is_immediate_danger",
            "priority_level",
            "emergency_classification",
            "safeguarding_classification",
            "classification_source",
            "classification_rule_version",
            "classification_trigger_codes",
            "classification_calculated_at",
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
            "assessment_completed_at",
            "assessment_care_plan_status",
            "assessment_care_plan_submitted_at",
            "assessment_care_plan_submitted_by",
            "assessment_care_plan_reviewed_at",
            "assessment_care_plan_reviewed_by",
            "assessment_care_plan_review_notes",
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
            "assessment_started_at",
            "assessment_due_at",
            "assessmentRemainingSeconds",
            "assessmentSlaStatus",
            "status",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "temporary_case_reference", "created_at", "updated_at", "reviewed_by", "reviewed_at", "allocated_by", "allocated_at",
            "assessment_completed_at", "assessment_care_plan_submitted_by",
            "assessment_care_plan_submitted_at", "assessment_care_plan_reviewed_by", "assessment_care_plan_reviewed_at",
            "closure_requested_by", "closure_requested_at",
            "closure_reviewed_by", "closure_reviewed_at",
            "safeguarding_classification", "classification_source", "classification_rule_version",
            "classification_trigger_codes", "classification_calculated_at",
        ]

    def get_allocatedOfficerName(self, obj):
        if obj.allocated_officer:
            return obj.allocated_officer.get_full_name() or obj.allocated_officer.username
        return ""

    def get_districtName(self, obj):
        """Return the owning district for both alert and direct intakes."""
        if obj.alert_id and obj.alert.district_id:
            return obj.alert.district.name
        profile = getattr(obj.created_by, "profile", None)
        district = getattr(profile, "district", None)
        return district.name if district else ""

    def get_reviewedByName(self, obj):
        if obj.reviewed_by:
            return obj.reviewed_by.get_full_name() or obj.reviewed_by.username
        return ""

    def get_allocatedByName(self, obj):
        if obj.allocated_by:
            return obj.allocated_by.get_full_name() or obj.allocated_by.username
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

    def assessment_deadline(self, obj):
        return obj.allocated_at + timedelta(days=7) if obj.allocated_at else None

    def get_assessment_started_at(self, obj):
        return obj.allocated_at

    def get_assessment_due_at(self, obj):
        return self.assessment_deadline(obj)

    def get_assessmentRemainingSeconds(self, obj):
        due_at = self.assessment_deadline(obj)
        if not due_at:
            return None
        end_at = obj.assessment_completed_at or timezone.now()
        return int((due_at - end_at).total_seconds())

    def get_assessmentSlaStatus(self, obj):
        remaining = self.get_assessmentRemainingSeconds(obj)
        if remaining is None:
            return "Not started"
        if obj.assessment_completed_at:
            return "Completed on time" if remaining >= 0 else "Completed late"
        if remaining < 0:
            return "Overdue"
        if remaining <= 24 * 60 * 60:
            return "Due soon"
        return "On track"

    def validate(self, attrs):
        attrs = relocate_child_location_fields(attrs, self.instance)
        child_profile = attrs.get("child_profile_draft")
        if child_profile is not None:
            if not isinstance(child_profile, dict):
                raise serializers.ValidationError({"child_profile_draft": "Child profile must be an object."})
            child_profile = deepcopy(child_profile)
            child_profile.pop("age_is_estimated", None)
            child_profile.pop("caregiver_present", None)
            if "address" in child_profile:
                child_profile.setdefault("address_of_child", child_profile["address"])
                child_profile.pop("address")
            for field in ("address_of_child", "reasons_for_intended_inquiry"):
                if field in child_profile and not isinstance(child_profile[field], str):
                    raise serializers.ValidationError({"child_profile_draft": {field: "Must be text."}})
            attrs["child_profile_draft"] = child_profile
            home_language = str(child_profile.get("home_language") or "").strip()
            religion = str(child_profile.get("religion") or "").strip()
            if home_language and home_language not in Intake.HOME_LANGUAGE_CHOICES:
                raise serializers.ValidationError({"child_profile_draft": {"home_language": f"Select one of: {', '.join(Intake.HOME_LANGUAGE_CHOICES)}."}})
            if religion and religion not in Intake.RELIGION_CHOICES:
                raise serializers.ValidationError({"child_profile_draft": {"religion": f"Select one of: {', '.join(Intake.RELIGION_CHOICES)}."}})

        alleged_perpetrators = attrs.get("alleged_perpetrators")
        if alleged_perpetrators is not None:
            if not isinstance(alleged_perpetrators, list):
                raise serializers.ValidationError({"alleged_perpetrators": "Must be a list of accused-person records."})
            allowed_values = {"", "Yes", "No", "Unknown"}
            cleaned_perpetrators = []
            for index, record in enumerate(alleged_perpetrators):
                if not isinstance(record, dict):
                    raise serializers.ValidationError({"alleged_perpetrators": {index: "Must be an object."}})
                cleaned = {key: str(record.get(key) or "").strip() for key in (
                    "id", "name", "relationship_to_child", "sex", "race", "referred_to_police",
                    "police_referral_date", "court_appearance_scheduled", "court_appearance_date",
                    "conviction_determined", "conviction_date", "circumstances_of_offence",
                )}
                if not cleaned["name"]:
                    raise serializers.ValidationError({"alleged_perpetrators": {index: {"name": "Accused name is required."}}})
                for field in ("referred_to_police", "court_appearance_scheduled", "conviction_determined"):
                    if cleaned[field] not in allowed_values:
                        raise serializers.ValidationError({"alleged_perpetrators": {index: {field: "Select Yes, No, or Unknown."}}})
                cleaned_perpetrators.append(cleaned)
            attrs["alleged_perpetrators"] = cleaned_perpetrators

        opening_summary = attrs.get("opening_summary")
        if opening_summary is not None and not isinstance(opening_summary, dict):
            raise serializers.ValidationError({"opening_summary": "Opening summary must be an object."})

        source = str(attrs.get("intake_source") or getattr(self.instance, "intake_source", "") or "DIRECT_INTAKE").strip().upper()
        source = {"ALERT": "ALERT_REFERRAL", "WALK_IN": "DIRECT_INTAKE", "MANUAL": "DIRECT_INTAKE"}.get(source, source)
        if source not in {"ALERT_REFERRAL", "DIRECT_INTAKE"}:
            raise serializers.ValidationError({"intake_source": "Select either Alert Referral or Direct Intake."})
        attrs["intake_source"] = source
        if source == "DIRECT_INTAKE":
            # A direct intake has no originating alert. Remove any stale alert
            # metadata rather than retaining it as blank or misleading data.
            direct_opening = deepcopy(opening_summary if opening_summary is not None else getattr(self.instance, "opening_summary", {}) or {})
            for key in ("alert_id", "alert_received_at", "alert_referred_at"):
                direct_opening.pop(key, None)
            direct_opening["source"] = "Direct Intake"
            attrs["opening_summary"] = direct_opening
        attrs = apply_emergency_attrs(attrs, self.instance)
        # apply_emergency_attrs merges partial updates with existing data; strip legacy
        # location keys once more so they cannot be reintroduced during that merge.
        attrs = relocate_child_location_fields(attrs, self.instance)
        attrs = remove_retired_screening_fields(attrs, self.instance)

        household_profile = attrs.get("household_profile_draft")
        if household_profile is not None:
            if not isinstance(household_profile, dict):
                raise serializers.ValidationError({"household_profile_draft": "Household profile must be an object."})
            household_profile = deepcopy(household_profile)

            def clean_family_member(member):
                if not isinstance(member, dict):
                    return member
                cleaned = {key: value for key, value in member.items() if key not in {"lives_with_child", "notes", "nature_of_support", "is_primary_caregiver"}}
                if str(cleaned.get("person_category") or "").strip() == "Significant Other":
                    cleaned.pop("telephone", None)
                if cleaned.get("living_involvement_status") == "Abandoned child":
                    cleaned["living_involvement_status"] = "Abandoned"
                elif cleaned.get("living_involvement_status") and cleaned.get("living_involvement_status") not in Intake.FAMILY_INVOLVEMENT_STATUSES:
                    cleaned["living_involvement_status"] = ""
                return cleaned

            family_members = household_profile.get("family_members", [])
            if family_members in (None, ""):
                family_members = []
            if not isinstance(family_members, list):
                raise serializers.ValidationError({"household_profile_draft": {"family_members": "Family members must be a list."}})
            cleaned_family_members = [clean_family_member(member) for member in family_members]
            household_profile["family_members"] = cleaned_family_members
            for legacy_key in ("guardians",):
                legacy_members = household_profile.get(legacy_key)
                if isinstance(legacy_members, list):
                    household_profile[legacy_key] = [clean_family_member(member) for member in legacy_members]
            for draft_key in ("draft_family_member", "draft_guardian"):
                if isinstance(household_profile.get(draft_key), dict):
                    household_profile[draft_key] = clean_family_member(household_profile[draft_key])
            attrs["household_profile_draft"] = household_profile
            family_members = cleaned_family_members
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
                if status_value == "Abandoned" and not str(member.get("date_abandoned") or "").strip():
                    raise serializers.ValidationError({"household_profile_draft": {"family_members": f"Date abandoned is required for family member {index + 1}."}})
                family_member_type = str(member.get("family_member_type") or member.get("guardian_type") or "").strip()
                number_of_wives = str(member.get("number_of_wives") or "").strip()
                order_of_wife = str(member.get("order_of_wife") or "").strip()
                if number_of_wives or order_of_wife:
                    if family_member_type not in Intake.WIFE_DETAIL_FAMILY_MEMBER_TYPES:
                        raise serializers.ValidationError({"household_profile_draft": {"family_members": f"Wife details are not applicable to family member {index + 1}."}})
                    if number_of_wives and (not number_of_wives.isdigit() or int(number_of_wives) < 1):
                        raise serializers.ValidationError({"household_profile_draft": {"family_members": f"Number of wives must be a positive whole number for family member {index + 1}."}})
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


class ReportGenerationSerializer(serializers.ModelSerializer):
    generatedBy = serializers.SerializerMethodField()
    generatedByRole = serializers.SerializerMethodField()
    provinceName = serializers.CharField(source="province.name", read_only=True, default="")
    districtName = serializers.CharField(source="district.name", read_only=True, default="")
    generatedAt = serializers.DateTimeField(source="generated_at", read_only=True)
    reportType = serializers.CharField(source="report_type", read_only=True)
    reportTitle = serializers.CharField(source="report_title", read_only=True)
    outputFormat = serializers.CharField(source="output_format", read_only=True)

    class Meta:
        model = ReportGeneration
        fields = [
            "id",
            "reference",
            "reportType",
            "reportTitle",
            "outputFormat",
            "filters",
            "summary",
            "provinceName",
            "districtName",
            "generatedBy",
            "generatedByRole",
            "generatedAt",
        ]

    def get_generatedBy(self, obj):
        return obj.generated_by.get_full_name() or obj.generated_by.username

    def get_generatedByRole(self, obj):
        profile = getattr(obj.generated_by, "profile", None)
        return profile.get_role_display() if profile else ""


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
        district = getattr(getattr(user, "profile", None), "district", None)
        task, _ = CalendarTask.objects.update_or_create(
            district=district,
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
