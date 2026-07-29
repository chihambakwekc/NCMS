import base64
import html
import json
import uuid
from copy import deepcopy
from datetime import timedelta
from pathlib import Path

from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import Q
from django.db.models.deletion import ProtectedError
from django.http import HttpResponse
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import SAFE_METHODS, AllowAny, IsAuthenticated
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Alert, AuditLog, CalendarTask, CaseNumberSequence, CommunityChildcareWorker, Court, District, Intake, MoreInformationRequest, Notification, NotificationRule, Organization, PartnersInDistrict, Province, RelationshipType, ReportGeneration, UpdateRequest, UserProfile, Ward
from .reporting import build_report_payload
from .serializers import (
    AlertSerializer,
    AuditLogSerializer,
    CalendarTaskSerializer,
    ChangePasswordSerializer,
    CommunityChildcareWorkerSerializer,
    CourtSerializer,
    DistrictSerializer,
    DistrictWriteSerializer,
    HealthSerializer,
    IntakeSerializer,
    LoginSerializer,
    MoreInformationRequestSerializer,
    NotificationRuleSerializer,
    NotificationSerializer,
    OrganizationSerializer,
    PartnersInDistrictSerializer,
    ProvinceSerializer,
    RelationshipTypeSerializer,
    ReportGenerationSerializer,
    UpdateRequestSerializer,
    UserSerializer,
    WardSerializer,
)

User = get_user_model()

NATIONAL_ROLES = {
    UserProfile.Role.SYS_ADMIN,
    UserProfile.Role.DEPUTY_DIRECTOR,
    UserProfile.Role.DIRECTOR,
    UserProfile.Role.PROGRAMME_OFFICER,
}
PROVINCIAL_ROLES = {UserProfile.Role.PROVINCIAL_HEAD}
DISTRICT_CASE_ROLES = {UserProfile.Role.DISTRICT_HEAD, UserProfile.Role.DSDO}
INTERNAL_ROLES = NATIONAL_ROLES | PROVINCIAL_ROLES | DISTRICT_CASE_ROLES
EXTERNAL_ROLES = {UserProfile.Role.CCW}

LEGACY_ASSESSMENT_SAFETY_KEYS = {
    "childSafe",
    "immediateDanger",
    "medicalEmergency",
    "ongoingAbuse",
    "perpetratorNearby",
    "policeNeeded",
    "alternativePlacement",
    "immediateActionRequired",
    "immediateActions",
    "immediateNotes",
    "responsibleOfficer",
    "actionDate",
    "outcome",
    "currentSafetyPosition",
    "furtherUrgentAction",
    "urgentFollowUpAction",
    "urgentFollowUpDueDate",
    "urgentFollowUpResponsible",
    "urgentFollowUpNotifySupervisor",
    "urgentFollowUpSupervisorNotifiedAt",
}


def clean_assessment_draft(value):
    if not isinstance(value, dict):
        return {}
    return {key: item for key, item in value.items() if key not in LEGACY_ASSESSMENT_SAFETY_KEYS}


def normalize_care_plan_item(value):
    if not isinstance(value, dict):
        return {}
    assistance_types = value.get("assistanceTypes") or value.get("assistance_types") or []
    if not isinstance(assistance_types, list):
        assistance_types = []
    assistance_type = value.get("assistanceType") or value.get("assistance_type") or (assistance_types[0] if assistance_types else "") or value.get("plannedAction") or value.get("intervention") or ""
    return {
        "problem": value.get("problem", ""),
        "problemArea": value.get("problemArea") or value.get("problem_area", ""),
        "assistanceType": assistance_type,
        "otherAssistanceDescription": value.get("otherAssistanceDescription") or value.get("other_assistance_description", ""),
        "goal": value.get("goal", ""),
        "plannedAction": value.get("plannedAction") or value.get("intervention", ""),
        "responsiblePerson": value.get("responsiblePerson") or value.get("responsible_person") or "Allocated Officer",
        "timeline": value.get("timeline") or value.get("deadline") or "30 Days",
        "dueDate": value.get("dueDate", ""),
        "status": value.get("status", "Planned"),
        "expectedOutcome": value.get("expectedOutcome", ""),
        "requiresCourtRecommendation": value.get("requiresCourtRecommendation") or value.get("requires_court_recommendation") or "No",
        "courtRecommendation": value.get("courtRecommendation") or value.get("court_recommendation", ""),
        "notes": value.get("notes", ""),
    }


def clean_care_plan_draft(value):
    if not isinstance(value, dict):
        return {"child_story": "", "items": []}
    items = []
    for item in value.get("items") or []:
        if not isinstance(item, dict):
            continue
        assistance_types = item.get("assistanceTypes") or item.get("assistance_types") or []
        if isinstance(assistance_types, list) and len(assistance_types) > 1:
            for assistance_type in assistance_types:
                items.append(normalize_care_plan_item({**item, "assistanceType": assistance_type, "assistanceTypes": [assistance_type], "plannedAction": assistance_type}))
        else:
            normalized = normalize_care_plan_item(item)
            if normalized:
                items.append(normalized)
    child_story = value.get("child_story") or value.get("childStory") or ""
    return {"child_story": child_story, "childStory": child_story, "items": items}


def plain_text(value, fallback=""):
    if value is None:
        return fallback
    if isinstance(value, (list, tuple)):
        joined = ", ".join(plain_text(item) for item in value if plain_text(item))
        return joined or fallback
    if isinstance(value, dict):
        return fallback
    text = str(value).strip()
    return text or fallback


def first_text(*values, fallback="Not provided"):
    for value in values:
        text = plain_text(value)
        if text:
            return text
    return fallback


def html_text(value, fallback="Not provided"):
    return html.escape(first_text(value, fallback=fallback))


def referral_pdf_logo_data_uri():
    logo_paths = [
        Path("/ncms-assets/cot.svg"),
        Path(__file__).resolve().parents[3] / "frontend" / "src" / "assets" / "cot.svg",
    ]
    logo_path = next((path for path in logo_paths if path.exists()), None)
    if not logo_path:
        return ""
    encoded = base64.b64encode(logo_path.read_bytes()).decode("ascii")
    return f"data:image/svg+xml;base64,{encoded}"


def user_display_name(user):
    name = " ".join(part for part in [user.first_name, user.last_name] if part).strip()
    return name or user.get_username()


def user_designation(user):
    profile = getattr(user, "profile", None)
    if not profile:
        return "Not provided"
    return profile.get_role_display() if hasattr(profile, "get_role_display") else plain_text(getattr(profile, "role", ""))


def select_guardian(family_members, keywords):
    for member in family_members:
        if not isinstance(member, dict):
            continue
        descriptor = " ".join([
            plain_text(member.get("guardian_type")),
            plain_text(member.get("family_member_type")),
            plain_text(member.get("relationship_to_child")),
            plain_text(member.get("person_category")),
        ]).lower()
        if any(keyword in descriptor for keyword in keywords):
            return member
    return {}


def build_referral_pdf_html(intake, referral, referral_index, request_user):
    opening = intake.opening_summary or {}
    child = intake.child_profile_draft or {}
    household = intake.household_profile_draft or {}
    background = intake.background_information or {}
    assessment = intake.assessment_draft or {}
    alert = intake.alert
    family_members = household.get("family_members") if isinstance(household.get("family_members"), list) else household.get("guardians") or []
    father = select_guardian(family_members, ("father", "male", "grandfather", "uncle"))
    mother = select_guardian(family_members, ("mother", "female", "grandmother", "aunt"))
    officer = intake.allocated_officer or request_user
    officer_profile = getattr(officer, "profile", None)
    district = first_text(
        getattr(getattr(alert, "district", None), "name", ""),
        getattr(getattr(officer_profile, "district", None), "name", ""),
        opening.get("officer_district"),
        fallback="Not provided",
    )
    officer_org = first_text(getattr(getattr(officer_profile, "organization", None), "name", ""), "Department of Social Development")
    officer_contact = first_text(getattr(officer_profile, "phone", ""), officer.email, opening.get("officer_contact"))
    circumstances = first_text(
        background.get("child_story_or_reported_circumstances"),
        assessment.get("currentSituation"),
        assessment.get("currentFamilySituation"),
        assessment.get("presentingProblem"),
        intake.initial_screening_notes,
        referral.get("briefCircumstances"),
        fallback="",
    )
    child_birth_id = first_text(child.get("id_number"), child.get("birth_certificate_number"), getattr(alert, "birth_certificate_number", ""), fallback="Not provided")
    logo_uri = referral_pdf_logo_data_uri()
    logo_html = f'<img class="logo" src="{logo_uri}" alt="National Coat of Arms" />' if logo_uri else ""
    referral_date = first_text(referral.get("date"), fallback=timezone.localdate().isoformat())

    def row(label, value):
        return f"<tr><th>{html.escape(label)}</th><td>{html_text(value)}</td></tr>"

    def guardian_rows(member):
        return "".join([
            row("Surname", member.get("surname") if member else ""),
            row("First Name", member.get("first_names") if member else ""),
            row("Address", member.get("address") if member else ""),
            row("Telephone", member.get("telephone") if member else ""),
        ])

    return f"""
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          @page {{ size: A4; margin: 18mm 16mm; }}
          body {{ font-family: Arial, sans-serif; color: #1f2937; font-size: 11px; line-height: 1.35; }}
          .header {{ text-align: center; border-bottom: 2px solid #111827; padding-bottom: 10px; margin-bottom: 14px; }}
          .logo {{ width: 82px; height: 82px; object-fit: contain; margin-bottom: 6px; }}
          h1, h2, h3 {{ margin: 0; text-transform: uppercase; }}
          h1 {{ font-size: 15px; letter-spacing: .4px; }}
          h2 {{ font-size: 14px; margin-top: 8px; }}
          h3 {{ font-size: 12px; margin: 14px 0 6px; padding: 5px 7px; background: #eef2f7; border: 1px solid #cbd5e1; }}
          table {{ width: 100%; border-collapse: collapse; margin-bottom: 8px; }}
          th, td {{ border: 1px solid #cbd5e1; padding: 6px 7px; vertical-align: top; }}
          th {{ width: 34%; background: #f8fafc; text-align: left; font-weight: 700; }}
          .meta th {{ width: 18%; }}
          .two-col {{ display: table; width: 100%; table-layout: fixed; border-spacing: 0; }}
          .col {{ display: table-cell; width: 50%; vertical-align: top; }}
          .col:first-child {{ padding-right: 5px; }}
          .col:last-child {{ padding-left: 5px; }}
          .box {{ border: 1px solid #cbd5e1; min-height: 56px; padding: 8px; margin-bottom: 8px; white-space: pre-wrap; }}
          .signature-space {{ height: 34px; border-bottom: 1px solid #111827; margin-top: 14px; }}
          .blank-lines td {{ height: 38px; }}
        </style>
      </head>
      <body>
        <div class="header">
          {logo_html}
          <h1>Ministry of Public Service, Labour and Social Welfare</h1>
          <h2>National Case Management System<br />Referral Form</h2>
        </div>
        <table class="meta">
          <tr><th>File No</th><td>{html_text(intake.temporary_case_reference)}</td><th>Referral Date</th><td>{html_text(referral_date)}</td></tr>
        </table>

        <h3>1. Child Details</h3>
        <table>
          {row("Surname", first_text(child.get("surname"), getattr(alert, "child_surname", ""), fallback="Not provided"))}
          {row("First Names", first_text(child.get("first_names"), getattr(alert, "child_first_name", ""), fallback="Not provided"))}
          {row("ID Number / Birth Certificate Number", child_birth_id)}
          {row("Sex", first_text(child.get("sex"), getattr(alert, "sex", ""), fallback="Not provided"))}
          {row("Date of Birth", first_text(child.get("date_of_birth"), getattr(alert, "date_of_birth", ""), fallback="Not provided"))}
          {row("Age", first_text(child.get("age"), getattr(alert, "age", ""), fallback="Not provided"))}
          {row("Case Number", intake.temporary_case_reference)}
        </table>

        <h3>2. Parent / Guardian Details</h3>
        <div class="two-col">
          <div class="col"><table><tr><th colspan="2">Father / Male Guardian</th></tr>{guardian_rows(father)}</table></div>
          <div class="col"><table><tr><th colspan="2">Mother / Female Guardian</th></tr>{guardian_rows(mother)}</table></div>
        </div>

        <h3>3. Brief Circumstances of Child</h3>
        <div class="box">{html_text(circumstances, fallback="")}</div>

        <h3>4. Reason for Referral</h3>
        <div class="box">{html_text(referral.get("reason"), fallback="")}</div>

        <h3>5. Referred By</h3>
        <table>
          {row("Referred By Name", user_display_name(officer))}
          {row("Designation", user_designation(officer))}
          {row("Organization", officer_org)}
          {row("Address", district)}
          {row("Contact Details", officer_contact)}
        </table>

        <h3>6. Referral Sent To</h3>
        <table>
          {row("Organization / Service Provider Name", first_text(referral.get("referredTo"), fallback="Not provided"))}
          {row("Address", referral.get("address"))}
          {row("Contact Details", referral.get("contactDetails"))}
          {row("Referral Type", referral.get("type"))}
          {row("Priority", referral.get("priority"))}
          {row("Expected Follow-up Date", referral.get("followUpDate"))}
        </table>

        <h3>7. Responsible Referring Signature</h3>
        <p>Responsible Referring Officer Signature:</p>
        <div class="signature-space"></div>
        <table>
          {row("Name", user_display_name(officer))}
          {row("Designation", user_designation(officer))}
          {row("Date", referral_date)}
        </table>

        <h3>8. Follow-up To Be Sent Back To Referring Agency</h3>
        <table class="blank-lines">
          {row("Phone or written confirmation that referral is received and accepted", "")}
          {row("Date Seen", "")}
          {row("Date Reported Back to Referring Organization", "")}
          {row("Action Taken / Services Provided", "")}
          {row("Name", "")}
          {row("Title", "")}
          {row("Signature", "")}
        </table>
        <p>Referral record: {html.escape(str(referral_index + 1))}</p>
      </body>
    </html>
    """


SUPERVISOR_ROLES = {UserProfile.Role.DISTRICT_HEAD} | (NATIONAL_ROLES - {UserProfile.Role.SYS_ADMIN})
FINAL_ALERT_STATUSES = {
    Alert.Status.CONVERTED,
    Alert.Status.SUPERVISOR_REVIEW,
    Alert.Status.APPROVED_ALLOCATION,
    Alert.Status.ALLOCATED,
    Alert.Status.REJECTED,
    Alert.Status.CLOSED,
    Alert.Status.DUPLICATE,
    Alert.Status.REFERRED,
}


def has_role(user, roles):
    return user.is_authenticated and hasattr(user, "profile") and user.profile.active and user.profile.role in roles


def audit(user, action, target, metadata=None):
    AuditLog.objects.create(
        actor=user if user.is_authenticated else None,
        action=action,
        target_type=target.__class__.__name__,
        target_reference=getattr(target, "reference", None) or getattr(target, "temporary_case_reference", "") or str(target.pk),
        metadata=metadata or {},
    )


def user_name(user):
    return user.get_full_name() or user.username


def intake_case_reference(intake):
    return intake.temporary_case_reference


def next_case_reference(district):
    if not district:
        raise ValueError("A district with a 3-letter code is required before a case number can be generated.")
    code = (district.code or "").strip().upper()
    if len(code) != 3 or not code.isalpha():
        raise ValueError("District code must be exactly 3 letters before a case number can be generated.")
    year = timezone.now().year
    with transaction.atomic():
        sequence, _ = CaseNumberSequence.objects.select_for_update().get_or_create(
            district=district,
            year=year,
            defaults={"next_number": 1},
        )
        number = sequence.next_number
        sequence.next_number = number + 1
        sequence.save(update_fields=["next_number"])
    return f"{code}/{year}/{number:04d}"


def notification_recipients(roles, district=None, province=None, exclude_user=None):
    qs = User.objects.select_related("profile").filter(is_active=True, profile__active=True, profile__role__in=roles)
    if district:
        qs = qs.filter(Q(profile__district=district) | Q(profile__role__in=NATIONAL_ROLES))
    elif province:
        qs = qs.filter(Q(profile__province=province) | Q(profile__role__in=NATIONAL_ROLES))
    if exclude_user:
        qs = qs.exclude(id=exclude_user.id)
    return qs


def create_notification(recipient, *, title, message, category, priority, target_type, target_id, action_label, route, dedupe_key, due_at=None):
    return Notification.objects.update_or_create(
        recipient=recipient,
        dedupe_key=dedupe_key,
        defaults={
            "title": title,
            "message": message,
            "category": category,
            "priority": priority,
            "target_type": target_type,
            "target_id": str(target_id),
            "action_label": action_label,
            "route": route,
            "due_at": due_at,
            "read_at": None,
            "resolved_at": None,
        },
    )[0]


def notify_users(recipients, **kwargs):
    for recipient in recipients:
        create_notification(recipient, **kwargs)


def resolve_notifications(target_type, target_id, dedupe_contains=None):
    qs = Notification.objects.filter(target_type=target_type, target_id=str(target_id), resolved_at__isnull=True)
    if dedupe_contains:
        qs = qs.filter(dedupe_key__icontains=dedupe_contains)
    qs.update(resolved_at=timezone.now())


def intake_draft_reminder_recipients(intake):
    district = intake.alert.district if intake.alert_id else getattr(getattr(intake.created_by, "profile", None), "district", None)
    recipients = User.objects.filter(id=intake.created_by_id, is_active=True)
    supervisors = notification_recipients([UserProfile.Role.DISTRICT_HEAD], district=district, exclude_user=intake.created_by)
    return (recipients | supervisors).distinct()


def maybe_notify_emergency_draft_reminders(user):
    now = timezone.now()
    reminder_interval = timedelta(hours=7)
    draft_intakes = Intake.objects.select_related("alert", "created_by", "created_by__profile").filter(
        status=Intake.Status.DRAFT,
        created_by__isnull=False,
    ).filter(Q(is_emergency=True) | Q(is_immediate_danger=True))
    if not has_role(user, NATIONAL_ROLES):
        draft_intakes = draft_intakes.filter(Q(created_by=user) | Q(alert__district=getattr(user.profile, "district", None)) | Q(alert__isnull=True, created_by__profile__district=getattr(user.profile, "district", None)))

    for intake in draft_intakes:
        if user.id not in set(intake_draft_reminder_recipients(intake).values_list("id", flat=True)):
            continue
        anchor = intake.created_at
        elapsed = now - anchor
        if elapsed < reminder_interval:
            continue
        reminder_number = int(elapsed.total_seconds() // reminder_interval.total_seconds())
        due_at = anchor + timedelta(hours=48)
        opening = intake.opening_summary or {}
        child_profile = intake.child_profile_draft or {}
        child = " ".join(str(child_profile.get(key) or "").strip() for key in ("first_names", "surname")).strip() or "Unknown child"
        classification = "Immediate danger" if intake.is_immediate_danger else "Emergency"
        dedupe_key = f"intake:{intake.id}:emergency-draft-reminder:{reminder_number}"
        if Notification.objects.filter(recipient=user, dedupe_key=dedupe_key).exists():
            continue
        create_notification(
            user,
            title=f"{classification} draft still pending",
            message=f"{intake_case_reference(intake)} | Child: {child} | This intake is still in draft and needs action before the SLA expires.",
            category="Intake",
            priority="critical" if intake.is_immediate_danger else "warning",
            target_type="case",
            target_id=intake.id,
            action_label="Open draft",
            route="case-intake",
            due_at=due_at,
            dedupe_key=dedupe_key,
        )


def notify_intake_submitted(intake):
    district = intake.alert.district if intake.alert_id else getattr(intake.created_by.profile, "district", None)
    recipients = notification_recipients([UserProfile.Role.DISTRICT_HEAD], district=district, exclude_user=intake.created_by)
    child = ""
    if intake.alert_id:
        child = intake.alert.child_display_name
    else:
        child_profile = intake.child_profile_draft or {}
        child = " ".join(str(child_profile.get(key) or "").strip() for key in ("first_names", "surname")).strip() or "Manual intake child"
    officer = intake.created_by.get_full_name() or intake.created_by.username
    submitted_at = timezone.localtime(intake.screening_completed_at or timezone.now()).strftime("%Y-%m-%d %H:%M")
    classification = intake.emergency_classification or "NON_EMERGENCY"
    is_immediate = classification == "EMERGENCY_IMMEDIATE_DANGER"
    is_emergency = intake.is_emergency or is_immediate
    notify_users(
        recipients,
        title="Immediate danger case submitted" if is_immediate else "Emergency case submitted" if is_emergency else "Intake submitted for review",
        message=(
            f"{intake_case_reference(intake)} | Child: {child} | District: {district.name if district else 'Not captured'} | "
            f"Officer: {officer} | Classification: {classification} | Submitted: {submitted_at}"
        ),
        category="Intake",
        priority="critical" if is_immediate else "warning" if is_emergency else "warning",
        target_type="case",
        target_id=intake.id,
        action_label="Review intake",
        route="review",
        dedupe_key=f"intake:{intake.id}:submitted-review",
    )
    resolve_notifications("case", intake.id, "emergency-draft-reminder")
    if is_emergency:
        AuditLog.objects.create(
            actor=intake.created_by,
            action="Emergency intake submitted",
            target_type="Intake",
            target_reference=intake_case_reference(intake),
            metadata={
                "child": child,
                "district": district.name if district else "",
                "officer": officer,
                "classification": classification,
                "priority_level": intake.priority_level,
                "submitted_at": submitted_at,
            },
        )


def notify_intake_ready_for_allocation(intake):
    district = intake.alert.district if intake.alert_id else getattr(intake.created_by.profile, "district", None)
    recipients = notification_recipients([UserProfile.Role.DISTRICT_HEAD], district=district)
    notify_users(
        recipients,
        title="Case needs allocation",
        message=f"{intake_case_reference(intake)} is approved and needs assignment to a DSDO.",
        category="Allocation",
        priority="warning",
        target_type="case",
        target_id=intake.id,
        action_label="Allocate case",
        route="allocation",
        dedupe_key=f"intake:{intake.id}:ready-allocation",
    )


def notify_case_allocated(intake):
    if not intake.allocated_officer_id:
        return
    due_at = intake.allocated_at + timedelta(days=7) if intake.allocated_at else None
    create_notification(
        intake.allocated_officer,
        title="Case allocated to you",
        message=f"{intake_case_reference(intake)} has been allocated to you for assessment and follow-up.",
        category="Allocation",
        priority="critical" if str(intake.risk_level).upper() in {"HIGH", "CRITICAL"} else "info",
        target_type="case",
        target_id=intake.id,
        action_label="Open case",
        route="case-intake",
        due_at=due_at,
        dedupe_key=f"intake:{intake.id}:allocated:{intake.allocated_officer_id}",
    )


def notify_assessment_care_plan_submitted(intake):
    district = intake.alert.district if intake.alert_id else getattr(intake.created_by.profile, "district", None)
    recipients = notification_recipients([UserProfile.Role.DISTRICT_HEAD], district=district, exclude_user=intake.assessment_care_plan_submitted_by)
    notify_users(
        recipients,
        title="Assessment and care plan submitted",
        message=f"{intake_case_reference(intake)} is waiting for supervisor assessment and care plan review.",
        category="Care Plan",
        priority="warning",
        target_type="case",
        target_id=intake.id,
        action_label="Open submission",
        route="allocated-cases",
        dedupe_key=f"intake:{intake.id}:assessment-care-plan-submitted",
    )


def scoped_by_location(qs, user):
    if has_role(user, NATIONAL_ROLES):
        return qs
    if has_role(user, PROVINCIAL_ROLES):
        return qs.filter(province=user.profile.province) if user.profile.province_id else qs.none()
    if has_role(user, DISTRICT_CASE_ROLES | {UserProfile.Role.CCW}):
        return qs.filter(district=user.profile.district) if user.profile.district_id else qs.none()
    return qs.none()


def apply_setup_filters(qs, request, name_fields=(), type_fields=()):
    province = request.query_params.get("province")
    district = request.query_params.get("district")
    ward = request.query_params.get("ward")
    status_value = request.query_params.get("status")
    type_value = request.query_params.get("type")
    search = request.query_params.get("search") or request.query_params.get("name")
    service = request.query_params.get("service")
    if province:
        qs = qs.filter(province_id=province)
    if district:
        qs = qs.filter(district_id=district)
    if ward and hasattr(qs.model, "ward"):
        qs = qs.filter(ward_id=ward)
    if status_value:
        qs = qs.filter(status=status_value)
    if type_value:
        type_q = Q()
        for field in type_fields:
            type_q |= Q(**{field: type_value})
        if type_q:
            qs = qs.filter(type_q)
    if service and qs.model is PartnersInDistrict:
        qs = qs.filter(services_offered__contains=[service])
    if search:
        name_q = Q()
        for field in name_fields:
            name_q |= Q(**{f"{field}__icontains": search})
        if name_q:
            qs = qs.filter(name_q)
    return qs


class LocationScopedSetupMixin:
    manage_roles = {UserProfile.Role.SYS_ADMIN, UserProfile.Role.DISTRICT_HEAD, UserProfile.Role.DSDO}

    def perform_create(self, serializer):
        extra = {"created_by": self.request.user, "updated_by": self.request.user}
        if has_role(self.request.user, DISTRICT_CASE_ROLES):
            extra["district"] = self.request.user.profile.district
        serializer.save(**extra)

    def perform_update(self, serializer):
        extra = {"updated_by": self.request.user}
        if has_role(self.request.user, DISTRICT_CASE_ROLES):
            extra["district"] = self.request.user.profile.district
        serializer.save(**extra)

    def can_manage_object(self, obj=None):
        user = self.request.user
        if has_role(user, NATIONAL_ROLES):
            return True
        if has_role(user, DISTRICT_CASE_ROLES):
            district_id = getattr(obj, "district_id", None) if obj else self.request.data.get("district")
            return bool(user.profile.district_id and str(district_id or user.profile.district_id) == str(user.profile.district_id))
        return False

    def create(self, request, *args, **kwargs):
        if not self.can_manage_object():
            return Response({"detail": "You do not have permission to create this setup record."}, status=status.HTTP_403_FORBIDDEN)
        return super().create(request, *args, **kwargs)

    def update(self, request, *args, **kwargs):
        if not self.can_manage_object(self.get_object()):
            return Response({"detail": "You do not have permission to update this setup record."}, status=status.HTTP_403_FORBIDDEN)
        return super().update(request, *args, **kwargs)

    def partial_update(self, request, *args, **kwargs):
        if not self.can_manage_object(self.get_object()):
            return Response({"detail": "You do not have permission to update this setup record."}, status=status.HTTP_403_FORBIDDEN)
        return super().partial_update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        if not self.can_manage_object(self.get_object()):
            return Response({"detail": "You do not have permission to delete this setup record."}, status=status.HTTP_403_FORBIDDEN)
        return super().destroy(request, *args, **kwargs)


class SystemAdminSetupMixin:
    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user, updated_by=self.request.user)

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)

    def can_manage(self):
        return has_role(self.request.user, {UserProfile.Role.SYS_ADMIN})

    def create(self, request, *args, **kwargs):
        if not self.can_manage():
            return Response({"detail": "Only system administrators can create this setup record."}, status=status.HTTP_403_FORBIDDEN)
        return super().create(request, *args, **kwargs)

    def update(self, request, *args, **kwargs):
        if not self.can_manage():
            return Response({"detail": "Only system administrators can update this setup record."}, status=status.HTTP_403_FORBIDDEN)
        return super().update(request, *args, **kwargs)

    def partial_update(self, request, *args, **kwargs):
        if not self.can_manage():
            return Response({"detail": "Only system administrators can update this setup record."}, status=status.HTTP_403_FORBIDDEN)
        return super().partial_update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        if not self.can_manage():
            return Response({"detail": "Only system administrators can delete this setup record."}, status=status.HTTP_403_FORBIDDEN)
        return super().destroy(request, *args, **kwargs)


class HealthView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        serializer = HealthSerializer({"status": "ok", "service": "ncms-api"})
        return Response(serializer.data)


class LoginView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        if serializer.validated_data.get("password_change_required"):
            return Response(
                {
                    "passwordChangeRequired": True,
                    "user": serializer.validated_data["user"],
                }
            )
        return Response(
            {
                "access": serializer.validated_data["access"],
                "refresh": serializer.validated_data["refresh"],
                "user": serializer.validated_data["user"],
            }
        )


class ChangePasswordView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = ChangePasswordSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return Response(serializer.save())


class MeView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(UserSerializer(request.user).data)


class LocationMasterDataView(APIView):
    """Return one authoritative Province/District snapshot for online forms."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user
        provinces = Province.objects.select_related("created_by", "updated_by").order_by("name")
        districts = District.objects.select_related("province", "created_by", "updated_by").order_by("province__name", "name")

        if has_role(user, PROVINCIAL_ROLES):
            provinces = provinces.filter(id=user.profile.province_id) if user.profile.province_id else provinces.none()
            districts = districts.filter(province_id=user.profile.province_id) if user.profile.province_id else districts.none()
        elif has_role(user, DISTRICT_CASE_ROLES | {UserProfile.Role.CCW}):
            provinces = provinces.filter(id=user.profile.district.province_id) if user.profile.district_id else provinces.none()
            districts = districts.filter(id=user.profile.district_id) if user.profile.district_id else districts.none()
        elif not has_role(user, NATIONAL_ROLES):
            provinces = provinces.none()
            districts = districts.none()

        return Response({
            "provinces": ProvinceSerializer(provinces, many=True).data,
            "districts": DistrictSerializer(districts, many=True).data,
        })


def new_report_reference():
    return f"NCMS/RPT/{timezone.localdate():%Y%m%d}/{uuid.uuid4().hex[:8].upper()}"


def record_report_generation(request, payload, output_format, reference):
    selected_district = payload["filters"].get("district")
    selected_province = payload["filters"].get("province")
    district = District.objects.select_related("province").filter(name__iexact=selected_district).first() if selected_district else None
    province = Province.objects.filter(name__iexact=selected_province).first() if selected_province else None
    if district:
        province = district.province
    profile = getattr(request.user, "profile", None)
    if not province and profile and getattr(profile, "province_id", None):
        province = profile.province
    if not district and profile and getattr(profile, "district_id", None):
        district = profile.district
        province = district.province
    return ReportGeneration.objects.create(
        reference=reference,
        report_type=request.query_params.get("report_type") or "analytics-summary",
        report_title=payload["reportTitle"],
        output_format=output_format,
        filters=payload["filters"],
        summary=payload["summary"],
        province=province,
        district=district,
        generated_by=request.user,
    )


class ReportsAnalyticsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        payload = build_report_payload(
            request.user,
            start=request.query_params.get("start") or None,
            end=request.query_params.get("end") or None,
            report_type=request.query_params.get("report_type") or None,
            province=request.query_params.get("province") or None,
            district=request.query_params.get("district") or None,
            status=request.query_params.get("status") or None,
            risk=request.query_params.get("risk") or None,
            category=request.query_params.get("category") or None,
        )
        return Response(payload)


class ReportsExcelExportView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        from openpyxl import Workbook

        payload = build_report_payload(
            request.user,
            start=request.query_params.get("start") or None,
            end=request.query_params.get("end") or None,
            report_type=request.query_params.get("report_type") or None,
            province=request.query_params.get("province") or None,
            district=request.query_params.get("district") or None,
            status=request.query_params.get("status") or None,
            risk=request.query_params.get("risk") or None,
            category=request.query_params.get("category") or None,
        )
        report_reference = new_report_reference()
        workbook = Workbook()
        summary = workbook.active
        summary.title = payload["reportTitle"][:31]
        summary.append(["Report", payload["reportTitle"]])
        summary.append(["Report reference", report_reference])
        summary.append(["Generated at", payload["generatedAt"]])
        selected_filters = [(key.replace("_", " ").title(), value) for key, value in payload["filters"].items() if value]
        if selected_filters:
            for label, value in selected_filters:
                summary.append([label, value])
        else:
            summary.append(["Data scope", "All authorised records"])
        summary.append([])
        summary.append(["Metric", "Value"])
        for key, value in payload["summary"].items():
            summary.append([key, value])

        response = HttpResponse(content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        response["Content-Disposition"] = 'attachment; filename="ncms-report.xlsx"'
        workbook.save(response)
        record_report_generation(request, payload, ReportGeneration.OutputFormat.EXCEL, report_reference)
        return response


class ReportsPdfExportView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        from weasyprint import HTML

        payload = build_report_payload(
            request.user,
            start=request.query_params.get("start") or None,
            end=request.query_params.get("end") or None,
            report_type=request.query_params.get("report_type") or None,
            province=request.query_params.get("province") or None,
            district=request.query_params.get("district") or None,
            status=request.query_params.get("status") or None,
            risk=request.query_params.get("risk") or None,
            category=request.query_params.get("category") or None,
        )
        metric_labels = {
            "totalAlerts": "Alerts received",
            "totalIntakes": "Cases registered",
            "allocatedCases": "Cases allocated",
            "highRiskAlerts": "High / critical risk alerts",
            "overdueAssessments": "Overdue assessments",
            "completedAssessments": "Completed assessments",
            "closedCases": "Cases closed",
            "averageAllocationDelaySeconds": "Average allocation delay (seconds)",
            "averageAllocationDelayLabel": "Average allocation time",
        }
        filter_labels = {
            "start": "Reporting period from",
            "end": "Reporting period to",
            "province": "Province",
            "district": "District",
            "status": "Case status",
            "risk": "Risk level",
            "category": "Case category",
        }
        selected_filters = [
            (filter_labels.get(key, key.replace("_", " ").title()), value)
            for key, value in payload["filters"].items()
            if value
        ]
        profile = getattr(request.user, "profile", None)
        generated_at = timezone.localtime()
        reference = new_report_reference()
        reporting_period = "All available dates"
        if payload["filters"].get("start") or payload["filters"].get("end"):
            reporting_period = f'{payload["filters"].get("start") or "Beginning"} to {payload["filters"].get("end") or "Present"}'
        geographic_scope = payload["filters"].get("district") or payload["filters"].get("province")
        if not geographic_scope and profile:
            geographic_scope = first_text(
                getattr(getattr(profile, "district", None), "name", ""),
                getattr(getattr(profile, "province", None), "name", ""),
                fallback="All authorised locations",
            )
        geographic_scope = geographic_scope or "All authorised locations"
        logo_uri = referral_pdf_logo_data_uri()
        logo_html = f'<img class="coat-of-arms" src="{logo_uri}" alt="National Coat of Arms" />' if logo_uri else ""

        summary_cells = "".join(
            f"""
            <td class="summary-card">
              <div class="summary-label">{html.escape(metric_labels.get(key, key.replace("_", " ").title()))}</div>
              <div class="summary-value">{html.escape(str(value))}</div>
            </td>
            """
            for key, value in payload["summary"].items()
            if not key.endswith("Seconds")
        )
        filter_rows = "".join(
            f"<tr><th>{html.escape(label)}</th><td>{html.escape(str(value))}</td></tr>"
            for label, value in selected_filters
        ) or '<tr><th>Additional filters</th><td>None — all records within the authorised scope</td></tr>'

        report_type = request.query_params.get("report_type") or ""
        charts = payload["charts"]
        section_definitions = {
            "case-statistics": [
                ("Workflow Status Breakdown", "Status", charts["caseStatus"]),
                ("District Distribution", "District", charts["casesByDistrict"]),
            ],
            "risk-trends": [
                ("Risk Level Distribution", "Risk level", charts["riskDistribution"]),
                ("Child Protection Concern Categories", "Case category", charts["concernDistribution"]),
            ],
            "intake-screening": [
                ("Intake and Screening Progression", "Workflow stage", charts["funnel"]),
                ("Monthly Intake Trend", "Month", charts["monthlyTrend"]),
            ],
            "assessment": [
                ("Assessment Completion Status", "Assessment status", charts["assessmentStatus"]),
                ("Cases by District", "District", charts["casesByDistrict"]),
            ],
            "referrals-services": [
                ("Cases by Category", "Case category", charts["concernDistribution"]),
                ("Cases by District", "District", charts["casesByDistrict"]),
            ],
            "review-closure": [
                ("Case Lifecycle Progression", "Workflow stage", charts["funnel"]),
                ("Workflow Status Breakdown", "Status", charts["caseStatus"]),
            ],
            "ccw-summary": [
                ("Monthly Case Activity", "Month", charts["monthlyTrend"]),
                ("Child Protection Concerns", "Case category", charts["concernDistribution"]),
            ],
            "geographic": [
                ("Cases by Province", "Province", charts["casesByProvince"]),
                ("Cases by District", "District", charts["casesByDistrict"]),
            ],
        }
        selected_sections = section_definitions.get(
            report_type,
            [("Workflow Status Breakdown", "Status", charts["caseStatus"]), ("Cases by District", "District", charts["casesByDistrict"])],
        )

        def breakdown_table(title, label_heading, rows):
            if rows:
                body = "".join(
                    f"<tr><td>{html.escape(str(row.get('name') or row.get('month') or 'Not captured'))}</td><td class='number'>{html.escape(str(row.get('value', 0)))}</td></tr>"
                    for row in rows
                )
                total = sum(int(row.get("value") or 0) for row in rows)
                body += f"<tr class='total-row'><td>Grand Total</td><td class='number'>{total}</td></tr>"
            else:
                body = "<tr><td colspan='2' class='empty-row'>No records were found for this breakdown.</td></tr>"
            return f"""
              <section class="breakdown-block">
                <h2>{html.escape(title)}</h2>
                <table class="data-table">
                  <thead><tr><th>{html.escape(label_heading)}</th><th class="number">Number of cases</th></tr></thead>
                  <tbody>{body}</tbody>
                </table>
              </section>
            """

        breakdown_html = "".join(
            breakdown_table(title, label_heading, rows)
            for title, label_heading, rows in selected_sections
        )
        document_html = f"""
        <html>
          <head>
            <meta charset="utf-8" />
            <style>
              @page {{
                size: A4 landscape;
                margin: 13mm 14mm 17mm;
                @bottom-left {{
                  content: "NCMS • Official Use Only";
                  color: #5c6b78;
                  font-family: Arial, sans-serif;
                  font-size: 8px;
                }}
                @bottom-center {{
                  content: "Ministry of Public Service, Labour and Social Welfare";
                  color: #5c6b78;
                  font-family: Arial, sans-serif;
                  font-size: 8px;
                }}
                @bottom-right {{
                  content: "Page " counter(page) " of " counter(pages);
                  color: #5c6b78;
                  font-family: Arial, sans-serif;
                  font-size: 8px;
                }}
              }}
              * {{ box-sizing: border-box; }}
              body {{ margin: 0; font-family: Arial, sans-serif; color: #183247; font-size: 10px; line-height: 1.35; }}
              .report-header {{ text-align: center; }}
              .coat-of-arms {{ width: 50px; height: 46px; object-fit: contain; margin: 0 auto 4px; }}
              .ministry {{ margin: 0; color: #082f49; font-size: 14px; font-weight: 800; text-transform: uppercase; letter-spacing: .25px; }}
              .system-name {{ margin: 2px 0 0; color: #0f5d62; font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: .7px; }}
              .report-title {{ margin: 5px 0 0; color: #172b3a; font-size: 13px; font-weight: 800; }}
              .brand-rule {{ height: 3px; margin: 9px 0 7px; background: #0f5d62; }}
              .reference-line {{ display: table; width: 100%; margin-bottom: 8px; color: #4d6070; font-size: 8.5px; }}
              .reference-line span {{ display: table-cell; }}
              .reference-line span:last-child {{ text-align: right; }}
              h2 {{ margin: 0 0 5px; color: #163a4d; font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: .35px; }}
              table {{ width: 100%; border-collapse: collapse; }}
              .metadata {{ margin-bottom: 9px; border: 1px solid #cbd7df; background: #f5f8fa; }}
              .metadata th, .metadata td {{ border: 1px solid #d7e0e6; padding: 5px 7px; text-align: left; }}
              .metadata th {{ width: 14%; color: #40566a; font-size: 8.5px; }}
              .metadata td {{ width: 36%; color: #172b3a; font-weight: 700; }}
              .summary-table {{ margin-bottom: 10px; border-collapse: separate; border-spacing: 5px 0; table-layout: fixed; }}
              .summary-card {{ padding: 8px 9px; border: 1px solid #c9d9dd; border-top: 3px solid #0f766e; background: #f4faf8; vertical-align: top; }}
              .summary-label {{ min-height: 22px; color: #4d6070; font-size: 8px; font-weight: 700; text-transform: uppercase; letter-spacing: .25px; }}
              .summary-value {{ margin-top: 3px; color: #12354a; font-size: 19px; font-weight: 800; }}
              .content-grid {{ display: table; width: 100%; table-layout: fixed; border-spacing: 8px 0; }}
              .content-column {{ display: table-cell; width: 50%; vertical-align: top; }}
              .report-breakdowns {{ margin-top: 9px; }}
              .breakdown-block {{ margin-bottom: 9px; }}
              .data-table th, .data-table td {{ border: 1px solid #cbd7df; padding: 5px 7px; text-align: left; }}
              .data-table thead {{ display: table-header-group; }}
              .data-table tr {{ break-inside: avoid; }}
              .data-table thead th {{ background: #dfeaf0; color: #12354a; font-size: 8.5px; }}
              .data-table tbody tr:nth-child(even) td {{ background: #f7f9fb; }}
              .data-table .number {{ width: 30%; text-align: right; font-variant-numeric: tabular-nums; }}
              .data-table .total-row td {{ background: #eaf3f2 !important; color: #0d4f53; font-weight: 800; }}
              .empty-row {{ padding: 12px !important; color: #667887; text-align: center !important; font-style: italic; }}
              .filter-table th, .filter-table td {{ border: 1px solid #d7e0e6; padding: 4px 6px; text-align: left; }}
              .filter-table th {{ width: 38%; background: #f5f8fa; color: #40566a; }}
              .certification {{ margin-top: 8px; padding-top: 6px; border-top: 1px solid #cbd7df; color: #667887; font-size: 8px; }}
            </style>
          </head>
          <body>
            <header class="report-header">
              {logo_html}
              <p class="ministry">Ministry of Public Service, Labour and Social Welfare</p>
              <p class="system-name">National Case Management Information System</p>
              <p class="report-title">{html.escape(payload["reportTitle"])}</p>
            </header>
            <div class="brand-rule"></div>
            <div class="reference-line">
              <span>Report reference: <strong>{html.escape(reference)}</strong></span>
              <span>Generated: <strong>{generated_at:%d %B %Y, %I:%M %p}</strong></span>
            </div>

            <table class="metadata">
              <tr>
                <th>Reporting user</th><td>{html.escape(user_display_name(request.user))}</td>
                <th>Designation</th><td>{html.escape(user_designation(request.user))}</td>
              </tr>
              <tr>
                <th>Reporting period</th><td>{html.escape(reporting_period)}</td>
                <th>Geographic scope</th><td>{html.escape(geographic_scope)}</td>
              </tr>
            </table>

            <h2>Report Summary</h2>
            <table class="summary-table"><tr>{summary_cells}</tr></table>

            <div class="content-grid">
              <div class="content-column">
                <section class="breakdown-block">
                  <h2>Selected Scope and Filters</h2>
                  <table class="filter-table">{filter_rows}</table>
                </section>
              </div>
              <div class="content-column">
                <section class="breakdown-block">
                  <h2>Report Notes</h2>
                  <table class="filter-table">
                    <tr><th>Source</th><td>National Case Management Information System</td></tr>
                    <tr><th>Data coverage</th><td>Records available to the reporting user under the assigned role and geographic scope.</td></tr>
                    <tr><th>Interpretation</th><td>Totals reflect the filters and reporting period displayed above.</td></tr>
                  </table>
                </section>
              </div>
            </div>
            <div class="report-breakdowns">{breakdown_html}</div>
            <p class="certification">This report was generated electronically by NCMS. Verify case-level information in the system before making statutory or operational decisions.</p>
          </body>
        </html>
        """
        pdf = HTML(string=document_html).write_pdf()
        response = HttpResponse(pdf, content_type="application/pdf")
        response["Content-Disposition"] = 'attachment; filename="ncms-report.pdf"'
        record_report_generation(request, payload, ReportGeneration.OutputFormat.PDF, reference)
        return response


class UserViewSet(viewsets.ModelViewSet):
    serializer_class = UserSerializer
    queryset = User.objects.select_related("profile", "profile__organization", "profile__province", "profile__district", "profile__ward").all()

    def get_queryset(self):
        if has_role(self.request.user, NATIONAL_ROLES):
            return self.queryset
        if has_role(self.request.user, PROVINCIAL_ROLES):
            return self.queryset.filter(profile__province=self.request.user.profile.province) if self.request.user.profile.province_id else self.queryset.none()
        if has_role(self.request.user, DISTRICT_CASE_ROLES):
            return self.queryset.filter(profile__district=self.request.user.profile.district)
        return self.queryset.filter(id=self.request.user.id)

    def create(self, request, *args, **kwargs):
        if not has_role(request.user, {UserProfile.Role.SYS_ADMIN}):
            return Response({"detail": "Only system administrators can create users."}, status=status.HTTP_403_FORBIDDEN)
        response = super().create(request, *args, **kwargs)
        audit(request.user, "User created", User.objects.get(id=response.data["id"]), {"role": response.data["profile"]["role"]})
        return response

    def destroy(self, request, *args, **kwargs):
        if not has_role(request.user, {UserProfile.Role.SYS_ADMIN}):
            return Response({"detail": "Only system administrators can delete users."}, status=status.HTTP_403_FORBIDDEN)
        user_to_delete = self.get_object()
        if user_to_delete.id == request.user.id:
            return Response({"detail": "You cannot delete your own account."}, status=status.HTTP_400_BAD_REQUEST)
        if (
            getattr(user_to_delete.profile, "role", "") == UserProfile.Role.SYS_ADMIN
            and not UserProfile.objects.filter(role=UserProfile.Role.SYS_ADMIN, active=True, user__is_active=True)
            .exclude(user=user_to_delete)
            .exists()
        ):
            return Response({"detail": "You cannot delete the last active system administrator."}, status=status.HTTP_400_BAD_REQUEST)
        username = user_to_delete.username
        try:
            user_to_delete.delete()
        except ProtectedError:
            return Response({"detail": f"{username} cannot be deleted because existing system records reference this account. Deactivate the user instead."}, status=status.HTTP_409_CONFLICT)
        audit(request.user, "User deleted", request.user, {"deleted_username": username})
        return Response(status=status.HTTP_204_NO_CONTENT)


class DistrictViewSet(viewsets.ModelViewSet):
    queryset = District.objects.select_related("province", "created_by", "updated_by").all().order_by("province__name", "name")

    def get_serializer_class(self):
        return DistrictWriteSerializer if self.action in {"create", "update", "partial_update"} else DistrictSerializer

    def get_queryset(self):
        qs = self.queryset
        user = self.request.user
        if has_role(user, PROVINCIAL_ROLES):
            qs = qs.filter(province=user.profile.province) if user.profile.province_id else qs.none()
        elif has_role(user, DISTRICT_CASE_ROLES | {UserProfile.Role.CCW}):
            qs = qs.filter(id=user.profile.district_id) if user.profile.district_id else qs.none()
        elif not has_role(user, NATIONAL_ROLES | EXTERNAL_ROLES):
            qs = qs.none()
        province = self.request.query_params.get("province")
        status_value = self.request.query_params.get("status")
        search = self.request.query_params.get("search") or self.request.query_params.get("name")
        if province:
            qs = qs.filter(province_id=province)
        if status_value:
            qs = qs.filter(status=status_value)
        if search:
            qs = qs.filter(name__icontains=search)
        return qs

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user, updated_by=self.request.user)

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)

    def create(self, request, *args, **kwargs):
        if not has_role(request.user, NATIONAL_ROLES):
            return Response({"detail": "Only National Admin can create districts."}, status=status.HTTP_403_FORBIDDEN)
        return super().create(request, *args, **kwargs)

    def update(self, request, *args, **kwargs):
        if not has_role(request.user, NATIONAL_ROLES):
            return Response({"detail": "Only National Admin can update districts."}, status=status.HTTP_403_FORBIDDEN)
        return super().update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        if not has_role(request.user, NATIONAL_ROLES):
            return Response({"detail": "Only National Admin can delete districts."}, status=status.HTTP_403_FORBIDDEN)
        return super().destroy(request, *args, **kwargs)


class ProvinceViewSet(viewsets.ModelViewSet):
    serializer_class = ProvinceSerializer
    queryset = Province.objects.select_related("created_by", "updated_by").all().order_by("name")

    def get_queryset(self):
        qs = self.queryset
        user = self.request.user
        if has_role(user, PROVINCIAL_ROLES):
            qs = qs.filter(id=user.profile.province_id) if user.profile.province_id else qs.none()
        elif has_role(user, DISTRICT_CASE_ROLES | {UserProfile.Role.CCW}):
            qs = qs.filter(id=user.profile.district.province_id) if user.profile.district_id else qs.none()
        elif not has_role(user, NATIONAL_ROLES | EXTERNAL_ROLES):
            qs = qs.none()
        search = self.request.query_params.get("search") or self.request.query_params.get("name")
        status_value = self.request.query_params.get("status")
        if search:
            qs = qs.filter(name__icontains=search)
        if status_value:
            qs = qs.filter(status=status_value)
        return qs

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user, updated_by=self.request.user)

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)

    def create(self, request, *args, **kwargs):
        if not has_role(request.user, NATIONAL_ROLES):
            return Response({"detail": "Only National Admin can create provinces."}, status=status.HTTP_403_FORBIDDEN)
        return super().create(request, *args, **kwargs)

    def update(self, request, *args, **kwargs):
        if not has_role(request.user, NATIONAL_ROLES):
            return Response({"detail": "Only National Admin can update provinces."}, status=status.HTTP_403_FORBIDDEN)
        return super().update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        if not has_role(request.user, NATIONAL_ROLES):
            return Response({"detail": "Only National Admin can delete provinces."}, status=status.HTTP_403_FORBIDDEN)
        return super().destroy(request, *args, **kwargs)


class WardViewSet(LocationScopedSetupMixin, viewsets.ModelViewSet):
    serializer_class = WardSerializer
    queryset = Ward.objects.select_related("province", "district", "created_by", "updated_by").all().order_by("district__name", "name")

    def get_queryset(self):
        return apply_setup_filters(scoped_by_location(self.queryset, self.request.user), self.request, name_fields=("name",))


class CommunityChildcareWorkerViewSet(LocationScopedSetupMixin, viewsets.ModelViewSet):
    serializer_class = CommunityChildcareWorkerSerializer
    queryset = CommunityChildcareWorker.objects.select_related("province", "district", "ward", "created_by", "updated_by").all()

    def get_queryset(self):
        return apply_setup_filters(scoped_by_location(self.queryset, self.request.user), self.request, name_fields=("full_name", "phone", "national_id"), type_fields=("gender",))


class PartnersInDistrictViewSet(LocationScopedSetupMixin, viewsets.ModelViewSet):
    serializer_class = PartnersInDistrictSerializer
    queryset = PartnersInDistrict.objects.select_related("province", "district", "created_by", "updated_by").all()

    def get_queryset(self):
        return apply_setup_filters(scoped_by_location(self.queryset, self.request.user), self.request, name_fields=("partner_name", "contact_person", "phone", "email"), type_fields=("partner_type",))


class CourtViewSet(LocationScopedSetupMixin, viewsets.ModelViewSet):
    serializer_class = CourtSerializer
    queryset = Court.objects.select_related("province", "district", "created_by", "updated_by").all()

    def get_queryset(self):
        return apply_setup_filters(scoped_by_location(self.queryset, self.request.user), self.request, name_fields=("court_name", "contact_person", "phone", "email"), type_fields=("court_type",))


class OrganizationViewSet(viewsets.ModelViewSet):
    serializer_class = OrganizationSerializer
    queryset = Organization.objects.all().order_by("name")

    def create(self, request, *args, **kwargs):
        if not has_role(request.user, {UserProfile.Role.SYS_ADMIN}):
            return Response({"detail": "Only system administrators can create organizations."}, status=status.HTTP_403_FORBIDDEN)
        return super().create(request, *args, **kwargs)


class RelationshipTypeViewSet(SystemAdminSetupMixin, viewsets.ModelViewSet):
    serializer_class = RelationshipTypeSerializer
    queryset = RelationshipType.objects.select_related("created_by", "updated_by").all().order_by("name")

    def get_queryset(self):
        qs = self.queryset
        status_value = self.request.query_params.get("status")
        search = self.request.query_params.get("search") or self.request.query_params.get("name")
        if status_value:
            qs = qs.filter(status=status_value)
        if search:
            qs = qs.filter(Q(name__icontains=search) | Q(description__icontains=search))
        return qs


class CaseReadOnlyForSystemAdminsMixin:
    """System admins can inspect nationwide case data but never change it."""

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        if request.method not in SAFE_METHODS and has_role(request.user, {UserProfile.Role.SYS_ADMIN}):
            raise PermissionDenied("System administrators have read-only access to cases and alerts.")


class AlertViewSet(CaseReadOnlyForSystemAdminsMixin, viewsets.ModelViewSet):
    serializer_class = AlertSerializer
    lookup_field = "reference"
    queryset = Alert.objects.select_related("reporter", "reporter__profile", "district", "ward", "assigned_intake_officer").prefetch_related("information_requests")

    def get_queryset(self):
        user = self.request.user
        qs = self.queryset
        if has_role(user, EXTERNAL_ROLES):
            return qs.filter(reporter=user)
        if has_role(user, DISTRICT_CASE_ROLES):
            return qs.filter(district=user.profile.district) if user.profile.district_id else qs.none()
        if has_role(user, PROVINCIAL_ROLES):
            return qs.filter(district__province=user.profile.province) if user.profile.province_id else qs.none()
        if has_role(user, NATIONAL_ROLES):
            return qs
        return qs.none()

    def create(self, request, *args, **kwargs):
        if not has_role(request.user, EXTERNAL_ROLES | INTERNAL_ROLES):
            return Response({"detail": "You do not have permission to submit alerts."}, status=status.HTTP_403_FORBIDDEN)
        return super().create(request, *args, **kwargs)

    def perform_create(self, serializer):
        alert = serializer.save()
        recipients = notification_recipients([UserProfile.Role.DISTRICT_HEAD], district=alert.district, exclude_user=alert.reporter)
        notify_users(
            recipients,
            title="Submitted intake needs allocation review",
            message=f"{alert.reference} is waiting for district review or conversion.",
            category="Intake",
            priority="critical" if alert.emergency else "warning",
            target_type="alert",
            target_id=alert.reference,
            action_label="Open alert",
            route="triage",
            dedupe_key=f"alert:{alert.id}:submitted",
        )

    @action(detail=True, methods=["post"])
    def triage(self, request, reference=None):
        alert = self.get_object()
        action_name = request.data.get("action")
        if not has_role(request.user, DISTRICT_CASE_ROLES | {UserProfile.Role.SYS_ADMIN}):
            return Response({"detail": "You do not have permission to triage alerts."}, status=status.HTTP_403_FORBIDDEN)
        if alert.status in FINAL_ALERT_STATUSES:
            return Response({"detail": f"Alert actions are locked because this alert is already {alert.status}."}, status=status.HTTP_400_BAD_REQUEST)

        if action_name == "validate":
            is_valid = request.data.get("is_valid")
            if is_valid is True or str(is_valid).lower() == "true":
                alert.validity_decision = Alert.ValidityDecision.VALID
                alert.invalid_reason = ""
                alert.status = Alert.Status.READY_INTAKE
                alert.internal_status = "Ready for Intake"
            elif is_valid is False or str(is_valid).lower() == "false":
                reason = str(request.data.get("reason") or "").strip()
                if not reason:
                    return Response({"detail": "Provide a reason before closing an invalid alert."}, status=status.HTTP_400_BAD_REQUEST)
                alert.validity_decision = Alert.ValidityDecision.INVALID
                alert.invalid_reason = reason
                alert.status = Alert.Status.CLOSED
                alert.internal_status = "Closed - No Further Action"
            else:
                return Response({"detail": "Select whether this is a valid child protection alert."}, status=status.HTTP_400_BAD_REQUEST)
        elif action_name == "accept":
            alert.status = Alert.Status.READY_INTAKE
            alert.internal_status = "Ready for Intake"
        elif action_name == "request_more_information":
            message = request.data.get("message", "Please provide more information.")
            MoreInformationRequest.objects.create(alert=alert, requested_by=request.user, message=message)
            alert.status = Alert.Status.MORE_INFO
            alert.internal_status = "More Information Required"
        elif action_name == "duplicate":
            alert.status = Alert.Status.DUPLICATE
            alert.internal_status = "Duplicate Review Required"
        elif action_name == "refer":
            alert.status = Alert.Status.REFERRED
            alert.internal_status = "Closed - Referred Externally"
        elif action_name == "close":
            alert.status = Alert.Status.CLOSED
            alert.internal_status = "Closed - No Further Action"
        elif action_name == "reject":
            alert.status = Alert.Status.REJECTED
            alert.internal_status = "Alert Rejected"
            alert.emergency = False
        elif action_name == "emergency":
            alert.status = Alert.Status.EMERGENCY
            alert.internal_status = "Immediate Action Required"
            alert.emergency = True
        elif action_name == "assign_intake":
            officer_id = request.data.get("officer_id")
            officer = User.objects.filter(id=officer_id, profile__role=UserProfile.Role.DSDO).first()
            if not officer:
                return Response({"detail": "Select a valid intake officer."}, status=status.HTTP_400_BAD_REQUEST)
            alert.assigned_intake_officer = officer
            alert.internal_status = "Intake Assigned"
        else:
            return Response({"detail": "Unknown triage action."}, status=status.HTTP_400_BAD_REQUEST)

        alert.save()
        audit(request.user, f"Triage action: {action_name}", alert)
        return Response(AlertSerializer(alert, context={"request": request}).data)

    @action(detail=True, methods=["post"], url_path="respond-more-info")
    def respond_more_info(self, request, reference=None):
        alert = self.get_object()
        if not has_role(request.user, EXTERNAL_ROLES):
            return Response({"detail": "Only external reporters can respond here."}, status=status.HTTP_403_FORBIDDEN)
        info_request = alert.information_requests.filter(resolved=False).order_by("-created_at").first()
        if not info_request:
            return Response({"detail": "No open information request found."}, status=status.HTTP_400_BAD_REQUEST)
        info_request.response = request.data.get("response", "")
        info_request.resolved = True
        info_request.responded_at = timezone.now()
        info_request.save()
        alert.status = Alert.Status.UNDER_REVIEW
        alert.internal_status = "Under Review"
        alert.save()
        audit(request.user, "More information submitted", alert)
        return Response(AlertSerializer(alert, context={"request": request}).data)

    @action(detail=True, methods=["post"], url_path="convert-to-intake")
    def convert_to_intake(self, request, reference=None):
        alert = self.get_object()
        if not has_role(request.user, DISTRICT_CASE_ROLES | {UserProfile.Role.SYS_ADMIN}):
            return Response({"detail": "You do not have permission to convert alerts."}, status=status.HTTP_403_FORBIDDEN)
        if alert.status != Alert.Status.CONVERTED and alert.status in FINAL_ALERT_STATUSES:
            return Response({"detail": f"This alert cannot be converted because it is already {alert.status}."}, status=status.HTTP_400_BAD_REQUEST)
        existing_intake = getattr(alert, "intake", None)
        if not existing_intake and alert.validity_decision != Alert.ValidityDecision.VALID:
            return Response({"detail": "Confirm that this is a valid child protection alert before converting it to intake."}, status=status.HTTP_400_BAD_REQUEST)
        if existing_intake:
            intake = existing_intake
            created = False
            case_reference = intake.temporary_case_reference
        else:
            try:
                case_reference = next_case_reference(alert.district)
            except ValueError as error:
                return Response({"detail": str(error)}, status=status.HTTP_400_BAD_REQUEST)
            intake = None
            created = True
        if created:
            intake = Intake.objects.create(
                alert=alert,
                temporary_case_reference=case_reference,
                intake_source="ALERT",
                original_alert_snapshot={
                    "alert_id": alert.reference,
                    "date_reported": alert.created_at.isoformat() if alert.created_at else "",
                    "reporter_name": alert.reporter.get_full_name() or alert.reporter.username,
                    "reporter_type": alert.reporter.profile.get_role_display() if hasattr(alert.reporter, "profile") else "",
                    "reporting_channel": alert.reporting_channel,
                    "information_source_type": alert.information_source_type,
                    "information_source_name": alert.information_source_name,
                    "information_source_surname": alert.information_source_surname,
                    "information_source_first_names": alert.information_source_first_names,
                    "information_source_id_number": alert.information_source_id_number,
                    "information_source_sex": alert.information_source_sex,
                    "information_source_contact": alert.information_source_contact,
                    "information_source_email": alert.information_source_email,
                    "information_source_address": alert.information_source_address,
                    "information_source_relationship_to_child": alert.information_source_relationship_to_child,
                    "information_source_reporter_type": alert.information_source_reporter_type,
                    "protect_source_identity": alert.protect_source_identity,
                    "district": alert.district.name if alert.district else "",
                    "ward": alert.ward.name if alert.ward else "",
                    "village": alert.village_suburb,
                    "chief_name": alert.chief_name,
                    "nearest_landmark": alert.nearest_landmark,
                    "home_address": alert.home_address,
                    "child_name": alert.child_display_name,
                    "child_first_name": alert.child_first_name,
                    "child_surname": alert.child_surname,
                    "child_alias": alert.child_alias,
                    "sex": alert.sex,
                    "age": alert.estimated_age,
                    "date_of_birth": alert.date_of_birth.isoformat() if alert.date_of_birth else "",
                    "birth_registered": alert.birth_registered,
                    "disability": alert.disability,
                    "caregiver_name": alert.caregiver_name,
                    "caregiver_contact": alert.caregiver_contact,
                    "relationship_to_child": alert.relationship_to_child,
                    "concern_categories": alert.concern_categories,
                    "incident_date": alert.incident_date.isoformat() if alert.incident_date else "",
                    "incident_location": alert.incident_location,
                    "description": alert.description,
                    "alleged_perpetrator_name": alert.alleged_perpetrator_name,
                    "alleged_perpetrator_relationship": alert.alleged_perpetrator_relationship,
                    "alleged_perpetrator_known": alert.alleged_perpetrator_known,
                    "alleged_perpetrator_sex": alert.alleged_perpetrator_sex,
                    "alleged_perpetrator_race": alert.alleged_perpetrator_race,
                    "alleged_perpetrator_address": alert.alleged_perpetrator_address,
                    "perpetrator_has_access": alert.perpetrator_has_access,
                    "referred_to_police": alert.referred_to_police,
                    "police_reference_number": alert.police_reference_number,
                    "police_referral_date": alert.police_referral_date.isoformat() if alert.police_referral_date else "",
                    "court_appearance_scheduled": alert.court_appearance_scheduled,
                    "court_appearance_date": alert.court_appearance_date.isoformat() if alert.court_appearance_date else "",
                    "conviction_determined": alert.conviction_determined,
                    "conviction_date": alert.conviction_date.isoformat() if alert.conviction_date else "",
                    "emergency": alert.emergency,
                    "status": alert.status,
                    "internal_status": alert.internal_status,
                },
                opening_summary={
                    "source": "Converted from alert",
                    "concern_summary": ", ".join(alert.concern_categories) if alert.concern_categories else "Uncategorized",
                    "reporter_narrative": alert.description,
                    "date_reported": alert.created_at.date().isoformat() if alert.created_at else "",
                    "reporting_channel": alert.reporting_channel,
                    "district": alert.district.name if alert.district else "",
                    "ward": alert.ward.name if alert.ward else "",
                    "village": alert.village_suburb,
                    "chief_name": alert.chief_name,
                    "nearest_landmark": alert.nearest_landmark,
                    "emergency_reported": "Yes" if alert.emergency else "No",
                    "immediate_danger_reported": "Yes" if alert.emergency else "No",
                    "informant": {
                        "surname": alert.information_source_surname,
                        "first_names": alert.information_source_first_names or alert.information_source_name,
                        "id_number": alert.information_source_id_number,
                        "sex": alert.information_source_sex,
                        "address": alert.information_source_address,
                        "relationship_to_child": alert.information_source_relationship_to_child,
                        "phone": alert.information_source_contact or alert.alternative_contact,
                        "email": alert.information_source_email,
                        "organization": alert.information_source_type,
                        "confidentiality": "Yes" if alert.protect_source_identity else "No",
                        "reporter_type": alert.information_source_reporter_type,
                    },
                    "screening_draft": {
                        "selected_categories": alert.concern_categories,
                        "alleged_perpetrator_known": alert.alleged_perpetrator_known,
                        "accused_name": alert.alleged_perpetrator_name,
                        "accused_relationship_to_child": alert.alleged_perpetrator_relationship,
                        "accused_sex": alert.alleged_perpetrator_sex,
                        "accused_race": alert.alleged_perpetrator_race,
                        "accused_address": alert.alleged_perpetrator_address,
                        "referred_to_police": alert.referred_to_police,
                        "police_reference_number": alert.police_reference_number,
                        "police_referral_date": alert.police_referral_date.isoformat() if alert.police_referral_date else "",
                        "court_appearance_scheduled": alert.court_appearance_scheduled,
                        "court_appearance_date": alert.court_appearance_date.isoformat() if alert.court_appearance_date else "",
                        "conviction_determined": alert.conviction_determined,
                        "conviction_date": alert.conviction_date.isoformat() if alert.conviction_date else "",
                    },
                },
                child_profile_draft={
                    "name": alert.child_display_name,
                    "sex": alert.sex,
                    "age": alert.estimated_age,
                    "address": alert.home_address,
                    "district": alert.district.name if alert.district else "",
                    "ward": alert.ward.name if alert.ward else "",
                },
                household_profile_draft={
                    "caregiver_name": alert.caregiver_name,
                    "caregiver_contact": alert.caregiver_contact,
                    "home_address": alert.home_address,
                },
                case_category=", ".join(alert.concern_categories[:1]) or "Uncategorized",
                risk_level="High" if alert.emergency else "Medium",
                immediate_action_required=alert.emergency,
                created_by=request.user,
            )
        alert.status = Alert.Status.CONVERTED
        alert.internal_status = "Intake In Progress"
        if not alert.assigned_intake_officer and has_role(request.user, {UserProfile.Role.DSDO}):
            alert.assigned_intake_officer = request.user
        alert.save()
        audit(request.user, "Alert converted to intake" if created else "Existing intake opened", alert)
        return Response(IntakeSerializer(intake, context={"request": request}).data, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)


class IntakeViewSet(CaseReadOnlyForSystemAdminsMixin, viewsets.ModelViewSet):
    serializer_class = IntakeSerializer
    queryset = Intake.objects.select_related("alert", "allocated_officer", "allocated_by", "reviewed_by", "created_by").all()

    def get_queryset(self):
        user = self.request.user
        qs = self.queryset
        if has_role(user, NATIONAL_ROLES):
            return qs
        if has_role(user, DISTRICT_CASE_ROLES):
            return qs.filter(Q(alert__district=user.profile.district) | Q(alert__isnull=True, created_by=user)) if user.profile.district_id else qs.filter(alert__isnull=True, created_by=user)
        if has_role(user, PROVINCIAL_ROLES):
            return qs.filter(Q(alert__district__province=user.profile.province) | Q(alert__isnull=True, created_by=user)) if user.profile.province_id else qs.filter(alert__isnull=True, created_by=user)
        return qs.none()

    def perform_update(self, serializer):
        previous = self.get_object()
        previous_status = previous.status
        previous_classification = previous.emergency_classification
        intake = serializer.save()
        if intake.status == Intake.Status.SUPERVISOR_REVIEW and previous_status != Intake.Status.SUPERVISOR_REVIEW:
            notify_intake_submitted(intake)
        if intake.status != Intake.Status.DRAFT or not (intake.is_emergency or intake.is_immediate_danger):
            resolve_notifications("case", intake.id, "emergency-draft-reminder")
        if previous_classification != intake.emergency_classification:
            audit(self.request.user, "Emergency safeguarding fields updated", intake, {
                "previous_classification": previous_classification,
                "new_classification": intake.emergency_classification,
                "priority_level": intake.priority_level,
                "reason": intake.emergency_change_reason,
            })

    def perform_create(self, serializer):
        source = self.request.data.get("intake_source") or "WALK_IN"
        if source == "WALK_IN":
            opening = self.request.data.get("opening_summary") or {}
            child = self.request.data.get("child_profile_draft") or {}
            informant = opening.get("informant") if isinstance(opening, dict) else {}
            captured_values = [
                opening.get("district") if isinstance(opening, dict) else "",
                opening.get("ward") if isinstance(opening, dict) else "",
                opening.get("reporter_narrative") if isinstance(opening, dict) else "",
            ]
            if isinstance(informant, dict):
                captured_values.extend(informant.values())
            if isinstance(child, dict):
                captured_values.extend(child.values())
            has_captured_data = any(str(value or "").strip() for value in captured_values)
            if not has_captured_data:
                raise ValidationError({"detail": "Enter case information before the first autosave. A case number has not been assigned."})
        district = getattr(getattr(self.request.user, "profile", None), "district", None)
        try:
            reference = next_case_reference(district)
        except ValueError as error:
            raise ValidationError({"detail": str(error)})
        serializer.save(
            created_by=self.request.user,
            temporary_case_reference=reference,
            intake_source=source,
        )

    @action(detail=True, methods=["post"])
    def screen(self, request, pk=None):
        intake = self.get_object()
        if not has_role(request.user, DISTRICT_CASE_ROLES | {UserProfile.Role.SYS_ADMIN}):
            return Response({"detail": "You do not have permission to screen intakes."}, status=status.HTTP_403_FORBIDDEN)
        if intake.alert:
            similar = Alert.objects.filter(
                district=intake.alert.district,
                child_first_name__iexact=intake.alert.child_first_name,
            ).exclude(id=intake.alert_id)
            intake.duplicate_result = "Potential duplicate review required" if intake.alert.child_first_name and similar.exists() else "No exact duplicate found"
        else:
            intake.duplicate_result = "No originating alert; manual duplicate review required"
        intake.initial_screening_notes = request.data.get("initial_screening_notes", intake.initial_screening_notes)
        intake.case_category = request.data.get("case_category", intake.case_category)
        intake.risk_level = request.data.get("risk_level", intake.risk_level)
        intake.immediate_action_required = request.data.get("immediate_action_required", intake.immediate_action_required)
        intake.immediate_action_plan = request.data.get("immediate_action_plan", intake.immediate_action_plan)
        screening_draft = request.data.get("screening_draft")
        if isinstance(screening_draft, dict):
            opening_summary = intake.opening_summary or {}
            existing_screening = opening_summary.get("screening_draft") or {}
            opening_summary["screening_draft"] = {**existing_screening, **screening_draft}
            intake.opening_summary = opening_summary
            immediate_danger = screening_draft.get("immediate_danger")
            emergency_required = screening_draft.get("emergency_required")
            if immediate_danger in {"Yes", "No"}:
                intake.is_immediate_danger = immediate_danger == "Yes"
            if emergency_required in {"Yes", "No"}:
                intake.is_emergency = emergency_required == "Yes"
            if intake.is_immediate_danger:
                intake.risk_level = "Critical"
                intake.priority_level = "Critical"
                intake.emergency_classification = "EMERGENCY_IMMEDIATE_DANGER"
                intake.immediate_action_required = True
            elif intake.is_emergency:
                intake.priority_level = "Emergency"
                intake.emergency_classification = "EMERGENCY"
                intake.immediate_action_required = True
            else:
                intake.priority_level = "Normal"
                intake.emergency_classification = "NON_EMERGENCY"
        if not intake.screening_completed_at:
            intake.screening_completed_at = timezone.now()
        intake.status = Intake.Status.SUPERVISOR_REVIEW
        intake.save()
        if intake.alert:
            intake.alert.status = Alert.Status.SUPERVISOR_REVIEW
            intake.alert.internal_status = "Pending Supervisor Review"
            intake.alert.save()
        audit(request.user, "Initial screening submitted", intake)
        notify_intake_submitted(intake)
        return Response(IntakeSerializer(intake, context={"request": request}).data)

    @action(detail=True, methods=["post"], url_path="supervisor-review")
    def supervisor_review(self, request, pk=None):
        intake = self.get_object()
        if not has_role(request.user, SUPERVISOR_ROLES):
            return Response({"detail": "Only supervisors can review intakes."}, status=status.HTTP_403_FORBIDDEN)
        decision = request.data.get("decision")
        intake.supervisor_notes = request.data.get("supervisor_notes", intake.supervisor_notes)
        intake.reviewed_by = request.user
        intake.reviewed_at = timezone.now()
        if decision == "approve":
            intake.status = Intake.Status.APPROVED
            if intake.alert:
                intake.alert.status = Alert.Status.APPROVED_ALLOCATION
                intake.alert.internal_status = "Approved for Allocation"
        elif decision == "return":
            intake.status = Intake.Status.RETURNED
            if intake.alert:
                intake.alert.status = Alert.Status.UNDER_REVIEW
                intake.alert.internal_status = "Returned for Correction"
        elif decision == "approve_emergency":
            intake.immediate_action_required = True
            intake.status = Intake.Status.APPROVED
            if intake.alert:
                intake.alert.status = Alert.Status.EMERGENCY
                intake.alert.internal_status = "Approved Emergency Action Plan"
                intake.alert.emergency = True
        else:
            return Response({"detail": "Unknown supervisor decision."}, status=status.HTTP_400_BAD_REQUEST)
        intake.save()
        if intake.alert:
            intake.alert.save()
        resolve_notifications("case", intake.id, "submitted-review")
        if decision in {"approve", "approve_emergency"}:
            notify_intake_ready_for_allocation(intake)
        review_delay_seconds = None
        if intake.screening_completed_at and intake.reviewed_at:
            review_delay_seconds = max(0, int((intake.reviewed_at - intake.screening_completed_at).total_seconds()))
        audit(request.user, f"Supervisor decision: {decision}", intake, {
            "screening_completed_at": intake.screening_completed_at.isoformat() if intake.screening_completed_at else "",
            "reviewed_at": intake.reviewed_at.isoformat() if intake.reviewed_at else "",
            "review_delay_seconds": review_delay_seconds,
        })
        return Response(IntakeSerializer(intake, context={"request": request}).data)

    @action(detail=True, methods=["post"])
    def allocate(self, request, pk=None):
        intake = self.get_object()
        if not has_role(request.user, SUPERVISOR_ROLES):
            return Response({"detail": "Only supervisors can allocate cases."}, status=status.HTTP_403_FORBIDDEN)
        officer = User.objects.filter(id=request.data.get("officer_id"), profile__role=UserProfile.Role.DSDO).first()
        if not officer:
            return Response({"detail": "Select a valid case officer."}, status=status.HTTP_400_BAD_REQUEST)
        intake.allocated_officer = officer
        intake.allocated_by = request.user
        intake.allocated_at = timezone.now()
        intake.status = Intake.Status.ALLOCATED
        intake.save()
        if intake.alert:
            intake.alert.status = Alert.Status.ALLOCATED
            intake.alert.internal_status = "Allocated to Case Officer"
            intake.alert.save()
        resolve_notifications("case", intake.id, "ready-allocation")
        notify_case_allocated(intake)
        allocation_delay_seconds = None
        if intake.screening_completed_at and intake.allocated_at:
            allocation_delay_seconds = max(0, int((intake.allocated_at - intake.screening_completed_at).total_seconds()))
        audit(request.user, "Case allocated", intake, {
            "officer": officer.username,
            "screening_completed_at": intake.screening_completed_at.isoformat() if intake.screening_completed_at else "",
            "allocated_at": intake.allocated_at.isoformat() if intake.allocated_at else "",
            "allocation_delay_seconds": allocation_delay_seconds,
        })
        return Response(IntakeSerializer(intake, context={"request": request}).data)

    @action(detail=True, methods=["post"], url_path="complete-assessment")
    def complete_assessment(self, request, pk=None):
        intake = self.get_object()
        if not intake.allocated_at or not intake.allocated_officer_id:
            return Response({"detail": "Assessment timer starts only after case allocation."}, status=status.HTTP_400_BAD_REQUEST)
        if not (request.user == intake.allocated_officer or has_role(request.user, SUPERVISOR_ROLES)):
            return Response({"detail": "Only the allocated officer or a supervisor can complete the assessment."}, status=status.HTTP_403_FORBIDDEN)
        completed_at = timezone.now()
        intake.assessment_completed_at = completed_at
        intake.assessment_completed_by = request.user
        intake.save(update_fields=["assessment_completed_at", "assessment_completed_by", "updated_at"])
        due_at = intake.allocated_at + timedelta(days=7)
        remaining_seconds = int((due_at - completed_at).total_seconds())
        audit(request.user, "Assessment completed", intake, {
            "assessment_started_at": intake.allocated_at.isoformat(),
            "assessment_due_at": due_at.isoformat(),
            "remaining_seconds": remaining_seconds,
        })
        return Response(IntakeSerializer(intake, context={"request": request}).data)

    @action(detail=True, methods=["post"], url_path="submit-assessment-care-plan")
    def submit_assessment_care_plan(self, request, pk=None):
        intake = self.get_object()
        if not intake.allocated_at or not intake.allocated_officer_id:
            return Response({"detail": "Assessment and care plan can only be submitted after allocation."}, status=status.HTTP_400_BAD_REQUEST)
        if request.user != intake.allocated_officer and not has_role(request.user, SUPERVISOR_ROLES):
            return Response({"detail": "Only the allocated officer can submit the assessment and care plan."}, status=status.HTTP_403_FORBIDDEN)
        assessment = clean_assessment_draft(request.data.get("assessment") or {})
        care_plan = clean_care_plan_draft(request.data.get("care_plan") or {})
        care_plan_versions = request.data.get("care_plan_versions") or []
        care_plan_change_logs = request.data.get("care_plan_change_logs") or []
        case_conferences = request.data.get("case_conferences") or []
        justice = request.data.get("justice") or {}
        referrals = request.data.get("referrals") or []
        service_tracking = request.data.get("service_tracking") or []
        case_notes = request.data.get("case_notes") or []
        case_documents = request.data.get("case_documents") or []
        monitoring_followups = request.data.get("monitoring_followups") or []
        if not assessment:
            return Response({"detail": "Assessment is required before the care plan can be submitted."}, status=status.HTTP_400_BAD_REQUEST)
        if not care_plan.get("items"):
            return Response({"detail": "Care plan is required for combined submission."}, status=status.HTTP_400_BAD_REQUEST)
        now = timezone.now()
        intake.assessment_draft = assessment
        intake.care_plan_draft = care_plan
        intake.care_plan_versions_draft = care_plan_versions
        intake.care_plan_change_logs_draft = care_plan_change_logs
        intake.case_conferences_draft = case_conferences
        intake.justice_draft = justice
        intake.referrals_draft = referrals
        intake.service_tracking_draft = service_tracking
        intake.case_notes_draft = case_notes
        intake.case_documents_draft = case_documents
        intake.monitoring_followups_draft = monitoring_followups
        intake.case_reviews_draft = request.data.get("case_reviews", intake.case_reviews_draft or [])
        intake.assessment_completed_at = intake.assessment_completed_at or now
        intake.assessment_completed_by = intake.assessment_completed_by or request.user
        intake.assessment_care_plan_status = "Submitted"
        intake.assessment_care_plan_submitted_at = now
        intake.assessment_care_plan_submitted_by = request.user
        intake.save()
        audit(request.user, "Assessment and care plan submitted", intake)
        notify_assessment_care_plan_submitted(intake)
        return Response(IntakeSerializer(intake, context={"request": request}).data)

    @action(detail=True, methods=["post"], url_path="save-execution-draft")
    def save_execution_draft(self, request, pk=None):
        intake = self.get_object()
        if not intake.allocated_at or not intake.allocated_officer_id:
            return Response({"detail": "Case execution drafts can only be saved after allocation."}, status=status.HTTP_400_BAD_REQUEST)
        if request.user != intake.allocated_officer and not has_role(request.user, SUPERVISOR_ROLES):
            return Response({"detail": "Only the allocated officer or a supervisor can save this case draft."}, status=status.HTTP_403_FORBIDDEN)

        intake.assessment_draft = clean_assessment_draft(request.data.get("assessment", intake.assessment_draft or {}))
        intake.care_plan_draft = clean_care_plan_draft(request.data.get("care_plan", intake.care_plan_draft or {}))
        intake.care_plan_versions_draft = request.data.get("care_plan_versions", intake.care_plan_versions_draft or [])
        intake.care_plan_change_logs_draft = request.data.get("care_plan_change_logs", intake.care_plan_change_logs_draft or [])
        intake.case_conferences_draft = request.data.get("case_conferences", intake.case_conferences_draft or [])
        intake.justice_draft = request.data.get("justice", intake.justice_draft or {})
        intake.referrals_draft = request.data.get("referrals", intake.referrals_draft or [])
        intake.service_tracking_draft = request.data.get("service_tracking", intake.service_tracking_draft or [])
        intake.case_notes_draft = request.data.get("case_notes", intake.case_notes_draft or [])
        intake.case_documents_draft = request.data.get("case_documents", intake.case_documents_draft or [])
        intake.monitoring_followups_draft = request.data.get("monitoring_followups", intake.monitoring_followups_draft or [])
        intake.case_reviews_draft = request.data.get("case_reviews", intake.case_reviews_draft or [])
        if intake.assessment_care_plan_status in {"", "Submitted"}:
            intake.assessment_care_plan_status = "Draft"
        intake.save()
        audit(request.user, "Case execution draft saved", intake)
        return Response(IntakeSerializer(intake, context={"request": request}).data)

    @action(detail=True, methods=["get"], url_path=r"referrals/(?P<referral_index>\d+)/pdf")
    def referral_pdf(self, request, pk=None, referral_index=None):
        from weasyprint import HTML

        intake = self.get_object()
        referrals = intake.referrals_draft if isinstance(intake.referrals_draft, list) else []
        index = int(referral_index)
        if index < 0 or index >= len(referrals) or not isinstance(referrals[index], dict):
            return Response({"detail": "Referral record not found."}, status=status.HTTP_404_NOT_FOUND)

        referral = referrals[index]
        pdf = HTML(string=build_referral_pdf_html(intake, referral, index, request.user)).write_pdf()
        filename = f"referral-{intake.temporary_case_reference}-{index + 1}.pdf".replace("/", "-")
        response = HttpResponse(pdf, content_type="application/pdf")
        response["Content-Disposition"] = f'attachment; filename="{filename}"'
        return response

    @action(detail=True, methods=["post"], url_path="review-assessment-care-plan")
    def review_assessment_care_plan(self, request, pk=None):
        intake = self.get_object()
        if not has_role(request.user, SUPERVISOR_ROLES):
            return Response({"detail": "Only supervisors can review assessment and care plan submissions."}, status=status.HTTP_403_FORBIDDEN)
        decision = request.data.get("decision")
        if decision not in {"approve", "request_revision", "approve_with_comments"}:
            return Response({"detail": "Unknown assessment and care plan decision."}, status=status.HTTP_400_BAD_REQUEST)
        intake.assessment_care_plan_status = {
            "approve": "Approved",
            "approve_with_comments": "Approved with Comments",
            "request_revision": "Revision Requested",
        }[decision]
        intake.assessment_care_plan_review_notes = request.data.get("notes", "")
        intake.assessment_care_plan_reviewed_at = timezone.now()
        intake.assessment_care_plan_reviewed_by = request.user
        intake.save()
        audit(request.user, f"Assessment and care plan review: {decision}", intake, {"notes": intake.assessment_care_plan_review_notes})
        resolve_notifications("case", intake.id, "assessment-care-plan-submitted")
        return Response(IntakeSerializer(intake, context={"request": request}).data)

    @action(detail=True, methods=["post"], url_path="supervisor-case-review")
    def supervisor_case_review(self, request, pk=None):
        intake = self.get_object()
        if request.user != intake.allocated_officer and not has_role(request.user, SUPERVISOR_ROLES):
            return Response({"detail": "Only the allocated officer or supervisor can record case reviews."}, status=status.HTTP_403_FORBIDDEN)
        decision = request.data.get("decision", "Continue Current Plan")
        case_reviews = request.data.get("case_reviews")
        if isinstance(case_reviews, list):
            intake.case_reviews_draft = case_reviews
        intake.last_case_review_decision = decision
        intake.last_case_review_notes = request.data.get("notes", "")
        intake.last_case_review_at = timezone.now()
        intake.last_case_review_by = request.user
        intake.save()
        audit(request.user, "Supervisor case review recorded", intake, {"decision": decision, "notes": intake.last_case_review_notes})
        return Response(IntakeSerializer(intake, context={"request": request}).data)

    @action(detail=True, methods=["post"], url_path="request-closure")
    def request_closure(self, request, pk=None):
        intake = self.get_object()
        if request.user != intake.allocated_officer and not has_role(request.user, SUPERVISOR_ROLES):
            return Response({"detail": "Only the allocated officer or supervisor can request closure."}, status=status.HTTP_403_FORBIDDEN)
        intake.closure_status = "Requested"
        closure_payload = request.data.get("closure") or {}
        closure_history = request.data.get("closure_history")
        intake.closure_draft = closure_payload
        if isinstance(closure_history, list):
            intake.closure_history_draft = closure_history
        intake.closure_review_notes = request.data.get("notes", "") or closure_payload.get("currentSituation", "") or closure_payload.get("closureSummary", "")
        intake.closure_requested_at = timezone.now()
        intake.closure_requested_by = request.user
        intake.save()
        audit(request.user, "Closure requested", intake, {"notes": intake.closure_review_notes})
        district = intake.alert.district if intake.alert_id else getattr(intake.created_by.profile, "district", None)
        notify_users(
            notification_recipients([UserProfile.Role.DISTRICT_HEAD], district=district, exclude_user=request.user),
            title="Closure request submitted",
            message=f"{intake_case_reference(intake)} has a closure request waiting for supervisor review.",
            category="Care Plan",
            priority="warning",
            target_type="case",
            target_id=intake.id,
            action_label="Review closure",
            route="allocated-cases",
            dedupe_key=f"intake:{intake.id}:closure-requested",
        )
        return Response(IntakeSerializer(intake, context={"request": request}).data)

    @action(detail=True, methods=["post"], url_path="review-closure")
    def review_closure(self, request, pk=None):
        intake = self.get_object()
        if not has_role(request.user, SUPERVISOR_ROLES):
            return Response({"detail": "Only supervisors can review closure requests."}, status=status.HTTP_403_FORBIDDEN)
        decision = request.data.get("decision")
        if decision not in {"approve", "reject"}:
            return Response({"detail": "Unknown closure decision."}, status=status.HTTP_400_BAD_REQUEST)
        intake.closure_status = "Approved" if decision == "approve" else "Rejected"
        if intake.closure_history_draft:
            latest = dict(intake.closure_history_draft[-1])
            latest["decision"] = "Approved" if decision == "approve" else "Rejected"
            latest["status"] = intake.closure_status
            latest["approvedBy"] = request.user.get_full_name() or request.user.username
            latest["approvedAt"] = timezone.now().isoformat()
            latest["supervisorReason"] = request.data.get("notes", "")
            intake.closure_history_draft = [*intake.closure_history_draft[:-1], latest]
        intake.closure_review_notes = request.data.get("notes", "")
        intake.closure_reviewed_at = timezone.now()
        intake.closure_reviewed_by = request.user
        intake.save()
        audit(request.user, f"Closure {decision}", intake, {"notes": intake.closure_review_notes})
        resolve_notifications("case", intake.id, "closure-requested")
        return Response(IntakeSerializer(intake, context={"request": request}).data)


def set_json_path(payload, path, value):
    if not path or value in (None, ""):
        return payload
    parts = path.split(".")
    cursor = payload
    for part in parts[:-1]:
        cursor = cursor.setdefault(part, {})
    try:
        parsed_value = json.loads(value) if isinstance(value, str) and value.strip().startswith(("{", "[")) else value
    except json.JSONDecodeError:
        parsed_value = value
    cursor[parts[-1]] = parsed_value
    return payload


def apply_intake_update_request(update_request):
    intake = update_request.intake
    changed = []
    direct_fields = {"case_category", "risk_level", "immediate_action_plan", "initial_screening_notes", "prior_assistance"}
    for field in update_request.requested_fields:
        path = field.get("path")
        proposed = field.get("proposed_value", field.get("new_value"))
        if not path or proposed in (None, ""):
            continue
        root = path.split(".")[0]
        if root in direct_fields and "." not in path:
            current_value = getattr(intake, root)
            setattr(intake, root, proposed)
            changed.append({
                "path": path,
                "label": field.get("label"),
                "from": field.get("current_value", field.get("old_value", current_value)),
                "to": proposed,
                "tab": field.get("tab_name") or update_request.tab,
                "section": field.get("section_name") or update_request.tab,
            })
            continue
        if root not in {"opening_summary", "child_profile_draft", "household_profile_draft", "background_information"}:
            continue
        current = deepcopy(getattr(intake, root) or {})
        set_json_path(current, ".".join(path.split(".")[1:]), proposed)
        setattr(intake, root, current)
        changed.append({
            "path": path,
            "label": field.get("label"),
            "from": field.get("current_value", field.get("old_value", "")),
            "to": proposed,
            "tab": field.get("tab_name") or update_request.tab,
            "section": field.get("section_name") or update_request.tab,
        })
    if changed:
        intake.save()
    return changed


class UpdateRequestViewSet(viewsets.ModelViewSet):
    serializer_class = UpdateRequestSerializer
    queryset = UpdateRequest.objects.select_related("intake", "requested_by", "reviewed_by").all()

    def get_queryset(self):
        user = self.request.user
        qs = self.queryset
        if has_role(user, NATIONAL_ROLES):
            return qs
        if has_role(user, PROVINCIAL_ROLES):
            return qs.filter(intake__created_by__profile__province=user.profile.province)
        if has_role(user, {UserProfile.Role.DISTRICT_HEAD}):
            return qs.filter(intake__created_by__profile__district=user.profile.district)
        if has_role(user, {UserProfile.Role.DSDO}):
            return qs.filter(Q(requested_by=user) | Q(intake__allocated_officer=user))
        return qs.none()

    def perform_create(self, serializer):
        update_request = serializer.save(requested_by=self.request.user)
        audit(self.request.user, "Intake update requested", update_request.intake, {
            "update_request_id": update_request.id,
            "tab": update_request.tab,
            "fields": update_request.requested_fields,
            "reason": update_request.reason,
        })
        intake = update_request.intake
        district = intake.alert.district if intake.alert_id else getattr(intake.created_by.profile, "district", None)
        notify_users(
            notification_recipients([UserProfile.Role.DISTRICT_HEAD], district=district, exclude_user=self.request.user),
            title="Intake update request submitted",
            message=f"{intake_case_reference(intake)} has an update request for {update_request.tab}.",
            category="Intake",
            priority="warning",
            target_type="case",
            target_id=intake.id,
            action_label="Review request",
            route="update-requests",
            dedupe_key=f"update-request:{update_request.id}:submitted",
        )

    @action(detail=True, methods=["post"])
    def review(self, request, pk=None):
        update_request = self.get_object()
        if not has_role(request.user, SUPERVISOR_ROLES):
            return Response({"detail": "Only supervisors can review update requests."}, status=status.HTTP_403_FORBIDDEN)
        if update_request.status != UpdateRequest.Status.PENDING:
            return Response({"detail": "This update request has already been reviewed."}, status=status.HTTP_400_BAD_REQUEST)
        decision = request.data.get("decision")
        update_request.review_notes = request.data.get("review_notes", update_request.review_notes)
        update_request.reviewed_by = request.user
        update_request.reviewed_at = timezone.now()
        if decision == "approve":
            changed = apply_intake_update_request(update_request)
            update_request.status = UpdateRequest.Status.APPROVED
            action = "Intake update approved"
        elif decision == "reject":
            changed = []
            update_request.status = UpdateRequest.Status.REJECTED
            action = "Intake update rejected"
        else:
            return Response({"detail": "Unknown review decision."}, status=status.HTTP_400_BAD_REQUEST)
        update_request.save()
        audit(request.user, action, update_request.intake, {
            "update_request_id": update_request.id,
            "tab": update_request.tab,
            "changed": changed,
            "review_notes": update_request.review_notes,
        })
        resolve_notifications("case", update_request.intake_id, f"update-request:{update_request.id}")
        return Response(UpdateRequestSerializer(update_request, context={"request": request}).data)


class MoreInformationRequestViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = MoreInformationRequestSerializer
    queryset = MoreInformationRequest.objects.select_related("alert", "requested_by").all()

    def get_queryset(self):
        user = self.request.user
        qs = self.queryset
        if has_role(user, EXTERNAL_ROLES):
            return qs.filter(alert__reporter=user)
        if has_role(user, INTERNAL_ROLES):
            return qs
        return qs.none()


class NotificationViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = NotificationSerializer
    queryset = Notification.objects.select_related("recipient").all()

    def get_queryset(self):
        maybe_notify_emergency_draft_reminders(self.request.user)
        qs = self.queryset.filter(recipient=self.request.user)
        if getattr(self, "action", "") == "mark_read":
            return qs
        filter_value = self.request.query_params.get("status", "active")
        if filter_value == "all":
            return qs
        if filter_value == "resolved":
            return qs.filter(resolved_at__isnull=False)
        qs = qs.filter(resolved_at__isnull=True)
        if filter_value == "unread":
            return qs.filter(read_at__isnull=True)
        if filter_value == "read":
            return qs.filter(read_at__isnull=False)
        return qs

    @action(detail=True, methods=["post"], url_path="mark-read")
    def mark_read(self, request, pk=None):
        notification = self.get_object()
        if not notification.read_at:
            notification.read_at = timezone.now()
            notification.save(update_fields=["read_at", "updated_at"])
        return Response(NotificationSerializer(notification, context={"request": request}).data)

    @action(detail=True, methods=["post"], url_path="resolve")
    def resolve(self, request, pk=None):
        notification = self.get_object()
        if not notification.resolved_at:
            notification.resolved_at = timezone.now()
            notification.save(update_fields=["resolved_at", "updated_at"])
        return Response(NotificationSerializer(notification, context={"request": request}).data)

    @action(detail=False, methods=["post"], url_path="mark-all-read")
    def mark_all_read(self, request):
        self.get_queryset().filter(read_at__isnull=True).update(read_at=timezone.now())
        return Response({"updated": True})


class NotificationRuleViewSet(viewsets.ModelViewSet):
    serializer_class = NotificationRuleSerializer
    queryset = NotificationRule.objects.all()

    def get_queryset(self):
        if has_role(self.request.user, NATIONAL_ROLES):
            return self.queryset
        return self.queryset.filter(enabled=True)

    def create(self, request, *args, **kwargs):
        if not has_role(request.user, NATIONAL_ROLES):
            return Response({"detail": "Only national administrators can create notification rules."}, status=status.HTTP_403_FORBIDDEN)
        return super().create(request, *args, **kwargs)

    def update(self, request, *args, **kwargs):
        if not has_role(request.user, NATIONAL_ROLES):
            return Response({"detail": "Only national administrators can update notification rules."}, status=status.HTTP_403_FORBIDDEN)
        return super().update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        if not has_role(request.user, NATIONAL_ROLES):
            return Response({"detail": "Only national administrators can delete notification rules."}, status=status.HTTP_403_FORBIDDEN)
        return super().destroy(request, *args, **kwargs)


class AuditLogViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = AuditLogSerializer
    queryset = AuditLog.objects.select_related("actor", "actor__profile", "actor__profile__province", "actor__profile__district").all()

    def get_queryset(self):
        if has_role(self.request.user, {UserProfile.Role.SYS_ADMIN}):
            return self.queryset
        return AuditLog.objects.none()


class ReportHistoryPagination(PageNumberPagination):
    page_size = 10
    page_size_query_param = "page_size"
    max_page_size = 50


class ReportGenerationViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = ReportGenerationSerializer
    pagination_class = ReportHistoryPagination
    queryset = ReportGeneration.objects.select_related(
        "generated_by",
        "generated_by__profile",
        "province",
        "district",
    ).all()

    def get_queryset(self):
        user = self.request.user
        queryset = self.queryset
        if has_role(user, NATIONAL_ROLES):
            pass
        elif has_role(user, PROVINCIAL_ROLES):
            queryset = queryset.filter(province=user.profile.province) if user.profile.province_id else queryset.none()
        elif has_role(user, {UserProfile.Role.DISTRICT_HEAD}):
            queryset = queryset.filter(district=user.profile.district) if user.profile.district_id else queryset.none()
        else:
            queryset = queryset.filter(generated_by=user)

        search = self.request.query_params.get("search", "").strip()
        output_format = self.request.query_params.get("format", "").strip().upper()
        report_type = self.request.query_params.get("report_type", "").strip()
        if search:
            queryset = queryset.filter(
                Q(reference__icontains=search)
                | Q(report_title__icontains=search)
                | Q(generated_by__username__icontains=search)
                | Q(generated_by__first_name__icontains=search)
                | Q(generated_by__last_name__icontains=search)
                | Q(province__name__icontains=search)
                | Q(district__name__icontains=search)
            )
        if output_format in {ReportGeneration.OutputFormat.PDF, ReportGeneration.OutputFormat.EXCEL}:
            queryset = queryset.filter(output_format=output_format)
        if report_type:
            queryset = queryset.filter(report_type=report_type)
        return queryset


class CalendarTaskViewSet(viewsets.ModelViewSet):
    serializer_class = CalendarTaskSerializer
    queryset = CalendarTask.objects.select_related("created_by").all()

    def get_queryset(self):
        user = self.request.user
        if has_role(user, NATIONAL_ROLES):
            return self.queryset
        if has_role(user, PROVINCIAL_ROLES):
            if not user.profile.province_id:
                return self.queryset.filter(district__isnull=True, created_by__profile__province=user.profile.province)
            return self.queryset.filter(
                Q(district__province=user.profile.province) |
                Q(district__isnull=True, created_by__profile__province=user.profile.province)
            )
        if has_role(user, DISTRICT_CASE_ROLES):
            if not user.profile.district_id:
                return self.queryset.filter(district__isnull=True, created_by=user)
            # The null fallback preserves access to existing tasks created
            # before CalendarTask gained its district field.
            return self.queryset.filter(
                Q(district=user.profile.district) |
                Q(district__isnull=True, created_by__profile__district=user.profile.district)
            )
        return self.queryset.filter(created_by=user)
