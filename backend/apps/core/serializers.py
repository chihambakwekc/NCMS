from copy import deepcopy
from datetime import timedelta

from django.contrib.auth import authenticate, get_user_model
from django.utils import timezone
from rest_framework import serializers
from rest_framework_simplejwt.tokens import RefreshToken

from .models import Alert, AuditLog, CalendarTask, District, Intake, MoreInformationRequest, Organization, Province, UpdateRequest, UserProfile, Ward

User = get_user_model()

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


def mask_opening_informant(opening):
    informant = opening.get("informant")
    if isinstance(informant, dict) and informant.get("confidentiality") == "Yes":
        mask_fields(informant, PROTECTED_INFORMANT_FIELDS)
    return opening


class HealthSerializer(serializers.Serializer):
    status = serializers.CharField()
    service = serializers.CharField()


class DistrictSerializer(serializers.ModelSerializer):
    province = serializers.IntegerField(source="province_id", read_only=True)
    provinceName = serializers.CharField(source="province.name", read_only=True)

    class Meta:
        model = District
        fields = ["id", "name", "code", "province", "provinceName"]


class ProvinceSerializer(serializers.ModelSerializer):
    class Meta:
        model = Province
        fields = ["id", "name"]


class WardSerializer(serializers.ModelSerializer):
    districtName = serializers.CharField(source="district.name", read_only=True)

    class Meta:
        model = Ward
        fields = ["id", "name", "district", "districtName"]


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
            "current_location",
            "home_address",
            "district",
            "districtName",
            "ward",
            "wardName",
            "village_suburb",
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
            "danger_screening",
            "incident_date",
            "date_reporter_became_aware",
            "incident_location",
            "description",
            "alleged_perpetrator_name",
            "alleged_perpetrator_relationship",
            "perpetrator_has_access",
            "immediate_action_taken",
            "services_contacted",
            "attachments",
            "status",
            "internalStatus",
            "emergency",
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
        return [key for key, value in obj.danger_screening.items() if value == "Yes"]

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

    def create(self, validated_data):
        user = self.context["request"].user
        concern_categories = validated_data.get("concern_categories", [])
        danger_screening = validated_data.get("danger_screening", {})
        urgent_concerns = {"Sexual abuse", "Physical abuse", "Child abandonment", "Child trafficking", "Child living/working on streets", "Medical support needed", "Food insecurity"}
        emergency = any(value == "Yes" for value in danger_screening.values()) or bool(set(concern_categories).intersection(urgent_concerns))
        validated_data["reporter"] = user
        validated_data["emergency"] = emergency
        validated_data["status"] = Alert.Status.EMERGENCY if emergency else Alert.Status.SUBMITTED
        validated_data["internal_status"] = "Immediate Action Required" if emergency else "Alert Submitted"
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
            "referrals_draft",
            "service_tracking_draft",
            "case_notes_draft",
            "case_documents_draft",
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

    def update(self, instance, validated_data):
        next_status = validated_data.get("status")
        if next_status == Intake.Status.SUPERVISOR_REVIEW and not instance.screening_completed_at:
            instance.screening_completed_at = timezone.now()
        return super().update(instance, validated_data)

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


class AuditLogSerializer(serializers.ModelSerializer):
    actorName = serializers.SerializerMethodField()

    class Meta:
        model = AuditLog
        fields = ["id", "actorName", "action", "target_type", "target_reference", "metadata", "created_at"]

    def get_actorName(self, obj):
        if not obj.actor:
            return "System"
        return obj.actor.get_full_name() or obj.actor.username


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
