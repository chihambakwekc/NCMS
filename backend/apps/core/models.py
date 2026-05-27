from django.conf import settings
from django.db import models


class Province(models.Model):
    name = models.CharField(max_length=120, unique=True)

    def __str__(self):
        return self.name


class District(models.Model):
    province = models.ForeignKey(Province, on_delete=models.PROTECT, related_name="districts")
    name = models.CharField(max_length=120)
    code = models.CharField(max_length=8)

    class Meta:
        unique_together = ("province", "name")

    def __str__(self):
        return self.name


class Ward(models.Model):
    district = models.ForeignKey(District, on_delete=models.PROTECT, related_name="wards")
    name = models.CharField(max_length=120)

    class Meta:
        unique_together = ("district", "name")

    def __str__(self):
        return f"{self.name}, {self.district.name}"


class Organization(models.Model):
    class Type(models.TextChoices):
        DSD = "DSD", "Department of Social Development"
        NGO = "NGO", "NGO"
        SCHOOL = "SCHOOL", "School"
        HEALTH = "HEALTH", "Health Facility"
        POLICE = "POLICE", "Police/VFU"
        CPC = "CPC", "Child Protection Committee"
        COMMUNITY = "COMMUNITY", "Community"

    name = models.CharField(max_length=180, unique=True)
    organization_type = models.CharField(max_length=30, choices=Type.choices)
    district = models.ForeignKey(District, on_delete=models.PROTECT, null=True, blank=True)

    def __str__(self):
        return self.name


class UserProfile(models.Model):
    class Role(models.TextChoices):
        SYS_ADMIN = "SYS_ADMIN", "System Administrator"
        DEPUTY_DIRECTOR = "DEPUTY_DIRECTOR", "Deputy Director"
        DIRECTOR = "DIRECTOR", "Director"
        PROGRAMME_OFFICER = "PROGRAMME_OFFICER", "Programme Officer"
        PROVINCIAL_HEAD = "PROVINCIAL_HEAD", "Provincial Head"
        DISTRICT_HEAD = "DISTRICT_HEAD", "District Head"
        DSDO = "DSDO", "DSDO"
        CCW = "CCW", "Community Case Worker"
        NGO = "NGO", "NGO"
        POLICE = "POLICE", "Police"
        TEACHER = "TEACHER", "Teacher"
        NURSE = "NURSE", "Nurse"

    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="profile")
    role = models.CharField(max_length=40, choices=Role.choices)
    phone = models.CharField(max_length=40, blank=True)
    organization = models.ForeignKey(Organization, on_delete=models.PROTECT, null=True, blank=True)
    province = models.ForeignKey(Province, on_delete=models.PROTECT, null=True, blank=True)
    district = models.ForeignKey(District, on_delete=models.PROTECT, null=True, blank=True)
    ward = models.ForeignKey(Ward, on_delete=models.PROTECT, null=True, blank=True)
    active = models.BooleanField(default=True)
    must_change_password = models.BooleanField(default=False)

    def __str__(self):
        return f"{self.user.username} - {self.get_role_display()}"

    @property
    def portal(self):
        return "external" if self.role in {"CCW", "NGO", "POLICE", "TEACHER", "NURSE"} else "internal"


class Alert(models.Model):
    class Status(models.TextChoices):
        SUBMITTED = "Submitted", "Submitted"
        RECEIVED = "Received by District Office", "Received by District Office"
        UNDER_REVIEW = "Under Review", "Under Review"
        MORE_INFO = "More Information Requested", "More Information Requested"
        CONVERTED = "Converted to Case", "Converted to Case"
        REFERRED = "Referred to Relevant Office", "Referred to Relevant Office"
        CLOSED = "Closed - No Further Action", "Closed - No Further Action"
        DUPLICATE = "Duplicate / Already Known", "Duplicate / Already Known"
        EMERGENCY = "Emergency Response Initiated", "Emergency Response Initiated"
        READY_INTAKE = "Ready for Intake", "Ready for Intake"
        INTAKE_PROGRESS = "Intake In Progress", "Intake In Progress"
        SUPERVISOR_REVIEW = "Pending Supervisor Review", "Pending Supervisor Review"
        APPROVED_ALLOCATION = "Approved for Allocation", "Approved for Allocation"
        ALLOCATED = "Allocated to Case Officer", "Allocated to Case Officer"
        REJECTED = "Rejected", "Rejected"

    reporter = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="submitted_alerts")
    reference = models.CharField(max_length=40, unique=True, blank=True)
    child_first_name = models.CharField(max_length=120, blank=True)
    child_surname = models.CharField(max_length=120, blank=True)
    child_alias = models.CharField(max_length=120, blank=True)
    sex = models.CharField(max_length=20, default="Unknown")
    estimated_age = models.CharField(max_length=40, blank=True, default="Unknown")
    date_of_birth = models.DateField(null=True, blank=True)
    birth_certificate_number = models.CharField(max_length=80, blank=True)
    birth_registered = models.CharField(max_length=20, default="Unknown")
    disability = models.CharField(max_length=20, default="Unknown")
    current_location = models.CharField(max_length=240, blank=True)
    home_address = models.CharField(max_length=240, blank=True)
    district = models.ForeignKey(District, on_delete=models.PROTECT, null=True, blank=True)
    ward = models.ForeignKey(Ward, on_delete=models.PROTECT, null=True, blank=True)
    village_suburb = models.CharField(max_length=160, blank=True)
    nearest_landmark = models.CharField(max_length=160, blank=True)
    nearest_school = models.CharField(max_length=160, blank=True)
    nearest_clinic = models.CharField(max_length=160, blank=True)
    caregiver_name = models.CharField(max_length=160, blank=True)
    caregiver_contact = models.CharField(max_length=80, blank=True)
    relationship_to_child = models.CharField(max_length=120, blank=True)
    protect_reporter_identity = models.BooleanField(default=False)
    intake_source = models.CharField(max_length=80, default="ALERT", blank=True)
    reporting_channel = models.CharField(max_length=120, blank=True)
    information_source_type = models.CharField(max_length=120, blank=True)
    information_source_other = models.CharField(max_length=160, blank=True)
    information_source_name = models.CharField(max_length=160, blank=True)
    information_source_surname = models.CharField(max_length=120, blank=True)
    information_source_first_names = models.CharField(max_length=160, blank=True)
    information_source_id_number = models.CharField(max_length=80, blank=True)
    information_source_sex = models.CharField(max_length=20, blank=True)
    information_source_contact = models.CharField(max_length=80, blank=True)
    information_source_email = models.EmailField(blank=True)
    information_source_address = models.CharField(max_length=240, blank=True)
    information_source_relationship_to_child = models.CharField(max_length=120, blank=True)
    information_source_reporter_type = models.CharField(max_length=120, blank=True)
    protect_source_identity = models.BooleanField(default=False)
    alternative_contact = models.CharField(max_length=80, blank=True)
    source_brief_description = models.TextField(blank=True)
    concern_categories = models.JSONField(default=list, blank=True)
    danger_screening = models.JSONField(default=dict, blank=True)
    incident_date = models.DateField(null=True, blank=True)
    date_reporter_became_aware = models.DateField(null=True, blank=True)
    incident_location = models.CharField(max_length=240, blank=True)
    description = models.TextField(blank=True)
    alleged_perpetrator_name = models.CharField(max_length=160, blank=True)
    alleged_perpetrator_relationship = models.CharField(max_length=120, blank=True)
    perpetrator_has_access = models.CharField(max_length=20, default="Unknown")
    immediate_action_taken = models.TextField(blank=True)
    services_contacted = models.TextField(blank=True)
    attachments = models.JSONField(default=list, blank=True)
    emergency = models.BooleanField(default=False)
    status = models.CharField(max_length=80, choices=Status.choices, default=Status.SUBMITTED)
    internal_status = models.CharField(max_length=80, default="Alert Submitted")
    assigned_intake_officer = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True, related_name="assigned_intake_alerts")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("-created_at",)

    def __str__(self):
        return self.reference or f"Alert {self.pk}"

    @property
    def child_display_name(self):
        name = " ".join(part for part in [self.child_first_name, self.child_surname] if part).strip()
        return name or self.child_alias or "Unknown child"

    def save(self, *args, **kwargs):
        if not self.reference and self.district_id:
            prefix = self.district.code.upper()
            year = self.created_at.year if self.created_at else 2026
            super().save(*args, **kwargs)
            self.reference = f"ALT-{year}-{prefix}-{self.pk:03d}"
            return super().save(update_fields=["reference"])
        return super().save(*args, **kwargs)


class Intake(models.Model):
    class Status(models.TextChoices):
        DRAFT = "Intake In Progress", "Intake In Progress"
        SUBMITTED = "Intake Submitted", "Intake Submitted"
        SCREENED = "Screening Completed", "Screening Completed"
        CATEGORIZED = "Categorized", "Categorized"
        SUPERVISOR_REVIEW = "Pending Supervisor Review", "Pending Supervisor Review"
        APPROVED = "Approved for Allocation", "Approved for Allocation"
        RETURNED = "Returned for Correction", "Returned for Correction"
        ALLOCATED = "Allocated to Case Officer", "Allocated to Case Officer"

    alert = models.OneToOneField(Alert, on_delete=models.PROTECT, related_name="intake", null=True, blank=True)
    temporary_case_reference = models.CharField(max_length=50, unique=True)
    intake_source = models.CharField(max_length=80, default="ALERT", blank=True)
    original_alert_snapshot = models.JSONField(default=dict, blank=True)
    opening_summary = models.JSONField(default=dict, blank=True)
    child_profile_draft = models.JSONField(default=dict, blank=True)
    household_profile_draft = models.JSONField(default=dict, blank=True)
    background_information = models.JSONField(default=dict, blank=True)
    prior_assistance = models.JSONField(default=list, blank=True)
    duplicate_result = models.CharField(max_length=240, blank=True)
    initial_screening_notes = models.TextField(blank=True)
    screening_completed_at = models.DateTimeField(null=True, blank=True)
    case_category = models.CharField(max_length=160, blank=True)
    risk_level = models.CharField(max_length=40, default="Pending")
    immediate_action_required = models.BooleanField(default=False)
    immediate_action_plan = models.TextField(blank=True)
    supervisor_notes = models.TextField(blank=True)
    reviewed_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True, related_name="reviewed_intakes")
    reviewed_at = models.DateTimeField(null=True, blank=True)
    allocated_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True, related_name="case_allocations_made")
    allocated_at = models.DateTimeField(null=True, blank=True)
    allocated_officer = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True, related_name="allocated_cases")
    assessment_draft = models.JSONField(default=dict, blank=True)
    care_plan_draft = models.JSONField(default=dict, blank=True)
    referrals_draft = models.JSONField(default=list, blank=True)
    service_tracking_draft = models.JSONField(default=list, blank=True)
    case_notes_draft = models.JSONField(default=list, blank=True)
    case_documents_draft = models.JSONField(default=list, blank=True)
    assessment_completed_at = models.DateTimeField(null=True, blank=True)
    assessment_completed_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True, related_name="completed_assessments")
    assessment_care_plan_status = models.CharField(max_length=40, default="Draft")
    assessment_care_plan_submitted_at = models.DateTimeField(null=True, blank=True)
    assessment_care_plan_submitted_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True, related_name="submitted_assessment_care_plans")
    assessment_care_plan_reviewed_at = models.DateTimeField(null=True, blank=True)
    assessment_care_plan_reviewed_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True, related_name="reviewed_assessment_care_plans")
    assessment_care_plan_review_notes = models.TextField(blank=True)
    last_case_review_at = models.DateTimeField(null=True, blank=True)
    last_case_review_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True, related_name="supervisor_case_reviews")
    last_case_review_decision = models.CharField(max_length=80, blank=True)
    last_case_review_notes = models.TextField(blank=True)
    closure_status = models.CharField(max_length=40, default="Not Requested")
    closure_requested_at = models.DateTimeField(null=True, blank=True)
    closure_requested_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True, related_name="closure_requests")
    closure_reviewed_at = models.DateTimeField(null=True, blank=True)
    closure_reviewed_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True, related_name="reviewed_closure_requests")
    closure_review_notes = models.TextField(blank=True)
    status = models.CharField(max_length=80, choices=Status.choices, default=Status.DRAFT)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="created_intakes")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.temporary_case_reference


class UpdateRequest(models.Model):
    class Status(models.TextChoices):
        PENDING = "Pending", "Pending"
        APPROVED = "Approved", "Approved"
        REJECTED = "Rejected", "Rejected"

    intake = models.ForeignKey(Intake, on_delete=models.CASCADE, related_name="update_requests")
    tab = models.CharField(max_length=80)
    requested_fields = models.JSONField(default=list, blank=True)
    reason = models.TextField()
    status = models.CharField(max_length=40, choices=Status.choices, default=Status.PENDING)
    requested_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="intake_update_requests")
    requested_at = models.DateTimeField(auto_now_add=True)
    reviewed_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True, related_name="reviewed_update_requests")
    reviewed_at = models.DateTimeField(null=True, blank=True)
    review_notes = models.TextField(blank=True)

    class Meta:
        ordering = ("-requested_at",)

    def __str__(self):
        return f"{self.intake.temporary_case_reference} - {self.tab} - {self.status}"


class MoreInformationRequest(models.Model):
    alert = models.ForeignKey(Alert, on_delete=models.CASCADE, related_name="information_requests")
    requested_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="information_requests_made")
    message = models.TextField()
    response = models.TextField(blank=True)
    resolved = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    responded_at = models.DateTimeField(null=True, blank=True)


class AuditLog(models.Model):
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True)
    action = models.CharField(max_length=160)
    target_type = models.CharField(max_length=80)
    target_reference = models.CharField(max_length=80)
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("-created_at",)


class CalendarTask(models.Model):
    title = models.CharField(max_length=160)
    detail = models.CharField(max_length=240, blank=True)
    date = models.DateField()
    urgent = models.BooleanField(default=False)
    source = models.CharField(max_length=80, blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="calendar_tasks")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("date", "title")
        unique_together = ("source", "title", "date")

    def __str__(self):
        return f"{self.date} - {self.title}"
