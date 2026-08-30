import base64
import calendar
import html
import json
import uuid
from collections import defaultdict
from copy import deepcopy
from datetime import timedelta
from pathlib import Path

from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import Q
from django.db.models.deletion import ProtectedError
from django.http import HttpResponse
from django.utils import timezone
from django.utils.dateparse import parse_datetime
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

ASSESSMENT_SCHEMA_VERSION = "APPROVED-MANUAL-2026-1"
ASSESSMENT_ADMIN_TEXT_FIELDS = {
    "assessmentDate",
    "assessmentType",
    "assessmentLocation",
    "childSeen",
    "parentCarerSeen",
    "otherPersonInterviewed",
    "assessmentVisitNotes",
    "childOwnStory",
    "otherMilestone",
}
ASSESSMENT_NARRATIVE_FIELDS = {
    "milestonesAssessmentNotes": "Milestones Assessment Notes",
    "personalityTraits": "Personality Traits",
    "healthStatusAndNeeds": "The Child's Health Status and Needs",
    "educationalStatusAndNeeds": "The Child's Educational Status and Needs",
    "provisionBasicCare": "Provision of Basic Care",
    "food": "Food",
    "shelter": "Shelter",
    "medication": "Medication",
    "disabilityIssues": "Disability Issues",
    "childSafetyNeeds": "Child's Safety Needs",
    "emotionalWarmth": "Emotional Warmth",
    "motivationAndStimulation": "Motivation and Stimulation",
    "guidanceAndBoundaries": "Guidance and Boundaries",
    "relationshipsSignificantOthers": "Relationships with Significant Others",
    "historyAndCurrentSituation": "History and Current Situation",
    "familyFunctioning": "Family Functioning",
    "familyRelationships": "Family Relationships",
    "dealingWithArguments": "Dealing with Arguments",
    "socialResources": "Social Resources",
    "communityResources": "Community Resources",
}
ASSESSMENT_INTERVIEW_OPTIONS = {"Child", "Mother", "Father", "Guardian", "Other caregiver", "Teacher", "Relative", "Community member", "Other"}
ASSESSMENT_CAREGIVER_INTERVIEW_OPTIONS = {"Mother", "Father", "Guardian", "Other caregiver"}
ASSESSMENT_MILESTONES = {"Sitting", "Crawling", "Walking", "Talking", "Toilet training", "Other"}


def clean_assessment_draft(value):
    if not isinstance(value, dict):
        return {}
    cleaned = {"schemaVersion": ASSESSMENT_SCHEMA_VERSION}
    for key in ASSESSMENT_ADMIN_TEXT_FIELDS:
        cleaned[key] = str(value.get(key) or "").strip()
    persons_interviewed = value.get("personsInterviewed") or []
    cleaned["personsInterviewed"] = [str(item).strip() for item in persons_interviewed if str(item).strip() in ASSESSMENT_INTERVIEW_OPTIONS] if isinstance(persons_interviewed, list) else []
    milestones = value.get("milestones") or []
    cleaned["milestones"] = [str(item).strip() for item in milestones if str(item).strip() in ASSESSMENT_MILESTONES] if isinstance(milestones, list) else []
    for key in ASSESSMENT_NARRATIVE_FIELDS:
        cleaned[key] = str(value.get(key) or "").strip()

    if cleaned["childSeen"] == "No" and "Child" in cleaned["personsInterviewed"]:
        raise ValidationError({"assessment": {"personsInterviewed": "Child cannot be selected when Child Seen is No."}})
    if "Child" in cleaned["personsInterviewed"]:
        cleaned["childSeen"] = "Yes"
    if cleaned["parentCarerSeen"] == "No" and ASSESSMENT_CAREGIVER_INTERVIEW_OPTIONS.intersection(cleaned["personsInterviewed"]):
        raise ValidationError({"assessment": {"personsInterviewed": "Parent/carer interview options cannot be selected when Parent/Carer Seen is No."}})
    return cleaned


def clean_justice_draft(value, system_case_number=""):
    """Normalize court orders and derive their immutable NCPMIS case number."""
    if not isinstance(value, dict):
        return {"courtOrders": []}
    court_orders = value.get("courtOrders") or []
    cleaned_orders = []
    for value in court_orders if isinstance(court_orders, list) else []:
        if not isinstance(value, dict):
            continue
        order = dict(value)
        order.pop("expiryDate", None)
        order.pop("expiry_date", None)
        if order.get("status") == "Expired":
            order["status"] = "Completed"
        order["systemCaseNumber"] = system_case_number
        cleaned_orders.append(order)
    return {"courtOrders": cleaned_orders}


def validate_assessment_submission(assessment):
    errors = {}
    for key, label in {
        "assessmentDate": "Assessment Date",
        "assessmentType": "Assessment Type",
        "assessmentLocation": "Assessment Location",
        "childSeen": "Child Seen",
        "parentCarerSeen": "Parent/Carer Seen",
    }.items():
        if not assessment.get(key):
            errors[key] = f"{label} is required."
    if not assessment.get("personsInterviewed"):
        errors["personsInterviewed"] = "At least one person interviewed is required."
    if "Other" in assessment.get("personsInterviewed", []) and not assessment.get("otherPersonInterviewed"):
        errors["otherPersonInterviewed"] = "Specify the other person interviewed."
    if "Other" in assessment.get("milestones", []) and not assessment.get("otherMilestone"):
        errors["otherMilestone"] = "Describe the other developmental milestone."

    if errors:
        raise ValidationError({"assessment": errors})


EXTERNAL_REFERRAL_RESPONSIBILITIES = {"Children's Court", "NGO Partner", "Health Facility", "Police", "School"}
NON_REFERRAL_RESPONSIBILITIES = {"Allocated Officer", "DSDO", "CCW", "Caregiver"}


def normalize_care_plan_item(value):
    if not isinstance(value, dict):
        return {}
    assistance_types = value.get("assistanceTypes") or value.get("assistance_types") or []
    if not isinstance(assistance_types, list):
        assistance_types = []
    assistance_type = value.get("assistanceType") or value.get("assistance_type") or (assistance_types[0] if assistance_types else "") or value.get("plannedAction") or value.get("intervention") or ""
    responsible_person = value.get("responsiblePerson") or value.get("responsible_person") or "Allocated Officer"
    referral_required = "Yes" if responsible_person in EXTERNAL_REFERRAL_RESPONSIBILITIES else "No" if responsible_person in NON_REFERRAL_RESPONSIBILITIES else value.get("referralRequired") or value.get("referral_required", "")
    return {
        "problem": value.get("problem", ""),
        "problemArea": value.get("problemArea") or value.get("problem_area", ""),
        "assistanceType": assistance_type,
        "otherAssistanceDescription": value.get("otherAssistanceDescription") or value.get("other_assistance_description", ""),
        "goal": value.get("goal", ""),
        "plannedAction": value.get("plannedAction") or value.get("intervention", ""),
        "responsiblePerson": responsible_person,
        "otherResponsiblePerson": value.get("otherResponsiblePerson") or value.get("other_responsible_person", ""),
        "referralRequired": referral_required,
        "timeline": value.get("timeline") or value.get("deadline") or "30 Days",
        "dueDate": value.get("dueDate", ""),
        "status": value.get("status", "Planned"),
        "actionPlanNotes": value.get("actionPlanNotes") or value.get("action_plan_notes") or value.get("expectedOutcome") or value.get("expected_outcome", ""),
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
    conference_held = "Yes" if value.get("case_conference_held") == "Yes" or value.get("caseConferenceHeld") == "Yes" else "No"
    return {"child_story": child_story, "childStory": child_story, "case_conference_held": conference_held, "caseConferenceHeld": conference_held, "items": items}


IMPLEMENTATION_STATUSES = {"Planned", "Referred", "In Progress", "Completed", "Cancelled"}
FOLLOW_UP_IMPLEMENTATION_STATUSES = {"Referred", "In Progress", "Completed"}
FOLLOW_UP_DATE_ACTIONS = {"Continue Current Care Plan", "Follow Up Again"}
RESOLUTION_REASONS = {
    "All objectives met",
    "Child died",
    "Child moved away",
    "No longer wants services",
    "Withdrawn from Court Ordered Supervision",
    "Other",
}
RESOLUTION_PROCESS_FIELDS = {
    "childFamilyDiscussionAgreed",
    "safetyConcernsResolved",
    "carePlanGoalsMet",
    "childAwareOfResources",
    "childEndingAgainstAdvice",
}


def clean_service_tracking(value, care_plan):
    """Keep implementation updates tied to, rather than able to alter, the care plan."""
    if not isinstance(value, list):
        return []
    care_items = care_plan.get("items", []) if isinstance(care_plan, dict) else []
    cleaned = []
    for index, item in enumerate(value):
        if not isinstance(item, dict):
            continue
        care_item = care_items[index] if index < len(care_items) and isinstance(care_items[index], dict) else {}
        status = item.get("status") or "Planned"
        if status == "Pending":
            status = "Planned"
        elif status == "Ongoing":
            status = "In Progress"
        elif status == "Failed":
            status = "Cancelled"
        elif status == "Accepted":
            status = "Referred"
        cleaned.append({
            "plannedAction": care_item.get("assistanceType") or care_item.get("plannedAction") or item.get("plannedAction", ""),
            "implementationDate": item.get("implementationDate") or item.get("updateDate") or "",
            "status": status if status in IMPLEMENTATION_STATUSES else "Planned",
            "deliveredBy": item.get("deliveredBy") or item.get("responsiblePerson") or "",
            "implementationNotes": item.get("implementationNotes") or item.get("progress") or item.get("outcome") or "",
        })
    return cleaned


def implementation_allows_follow_up(service_tracking):
    return any(
        isinstance(item, dict) and item.get("status") in FOLLOW_UP_IMPLEMENTATION_STATUSES
        for item in service_tracking
    )


def follow_up_links_eligible_intervention(record, service_tracking):
    if not isinstance(record, dict):
        return False
    linked_activity = str(record.get("carePlanItemFollowedUp") or "").strip()
    return bool(linked_activity) and any(
        isinstance(item, dict)
        and item.get("status") in FOLLOW_UP_IMPLEMENTATION_STATUSES
        and str(item.get("plannedAction") or "").strip() == linked_activity
        for item in service_tracking
    )


def clean_monitoring_followups(value):
    """Enforce next-action scheduling rules even when requests bypass the UI."""
    if not isinstance(value, list):
        raise ValidationError({"monitoring_followups": "Monitoring follow-ups must be a list."})
    cleaned = []
    for index, item in enumerate(value):
        if not isinstance(item, dict):
            raise ValidationError({"monitoring_followups": {index: "The follow-up record is invalid."}})
        record = dict(item)
        next_action = str(record.get("recommendedNextStep") or "").strip()
        if next_action in FOLLOW_UP_DATE_ACTIONS:
            if not str(record.get("nextFollowUpDate") or "").strip():
                raise ValidationError({"monitoring_followups": {index: {"nextFollowUpDate": "A next follow-up date is required for the selected next action."}}})
        else:
            record["nextFollowUpDate"] = ""
        cleaned.append(record)
    return cleaned


def clean_referrals_draft(value):
    """Remove retired referral fields before persisting JSON draft records."""
    if not isinstance(value, list):
        return []
    cleaned = []
    for item in value:
        if not isinstance(item, dict):
            continue
        referral = dict(item)
        referral.pop("followUpRequired", None)
        referral.pop("follow_up_required", None)
        referral.pop("status", None)
        cleaned.append(referral)
    return cleaned


def clean_case_notes_draft(value):
    """Normalize case notes while preserving their immutable audit metadata."""
    if not isinstance(value, list):
        raise ValidationError({"case_notes": "Case notes must be a list."})
    cleaned = []
    legacy_fields = (
        ("Date", "date"),
        ("Activity Type", "activityType"),
        ("Person Contacted", "person"),
        ("Summary / Action Taken", "summary"),
        ("Next Step", "nextStep"),
        ("Follow-up Date", "followUp"),
    )
    for index, item in enumerate(value):
        if not isinstance(item, dict):
            continue
        note = str(item.get("caseNote") or "").strip()
        if not note:
            note = "\n".join(
                f"{label}: {str(item.get(key) or '').strip()}"
                for label, key in legacy_fields
                if str(item.get(key) or "").strip()
            )
        if note:
            cleaned.append({
                "id": str(item.get("id") or f"legacy-{index}"),
                "caseNote": note,
                "createdAt": str(item.get("createdAt") or ""),
            })
    return cleaned


def reconcile_case_notes_draft(existing_value, proposed_value):
    """Allow note changes for 24 hours, then preserve the historical record."""
    existing = clean_case_notes_draft(existing_value or [])
    proposed = clean_case_notes_draft(proposed_value or [])
    proposed_by_id = {note["id"]: note for note in proposed}
    now = timezone.now()
    reconciled = []

    for old_note in existing:
        created_at = parse_datetime(old_note.get("createdAt") or "")
        editable = bool(created_at and now - created_at <= timedelta(hours=24))
        replacement = proposed_by_id.pop(old_note["id"], None)
        if replacement is None:
            if not editable:
                reconciled.append(old_note)
            continue
        reconciled.append({**old_note, "caseNote": replacement["caseNote"]} if editable else old_note)

    for note in proposed_by_id.values():
        reconciled.append({
            "id": str(uuid.uuid4()),
            "caseNote": note["caseNote"],
            "createdAt": now.isoformat(),
        })
    return reconciled


def missing_required_referrals(care_plan, referrals, service_tracking):
    care_items = care_plan.get("items", []) if isinstance(care_plan, dict) else []
    valid_referral_links = {
        str(item.get("linkedCarePlanItem") or "").strip()
        for item in referrals
        if isinstance(item, dict) and str(item.get("linkedCarePlanItem") or "").strip()
    }
    missing = []
    for index, care_item in enumerate(care_items):
        if not isinstance(care_item, dict) or care_item.get("referralRequired") != "Yes":
            continue
        service = service_tracking[index] if index < len(service_tracking) and isinstance(service_tracking[index], dict) else {}
        if service.get("status") not in FOLLOW_UP_IMPLEMENTATION_STATUSES:
            continue
        activity = str(care_item.get("assistanceType") or care_item.get("plannedAction") or "").strip()
        if activity and activity not in valid_referral_links:
            missing.append(activity)
    return missing


def clean_resolution_payload(value):
    """Validate and retain the mandatory Case Resolution Form information."""
    if not isinstance(value, dict):
        raise ValidationError({"resolution": "Resolution details are required."})
    reasons = value.get("reasons")
    if not isinstance(reasons, list) or not reasons:
        raise ValidationError({"resolution": {"reasons": "Select at least one reason for resolution."}})
    invalid_reasons = [reason for reason in reasons if reason not in RESOLUTION_REASONS]
    if invalid_reasons:
        raise ValidationError({"resolution": {"reasons": "One or more resolution reasons are invalid."}})
    if "Other" in reasons and not str(value.get("otherReason") or "").strip():
        raise ValidationError({"resolution": {"otherReason": "Explain the other reason for resolution."}})
    if not str(value.get("currentSituation") or value.get("resolutionSummary") or "").strip():
        raise ValidationError({"resolution": {"currentSituation": "Provide a description of the resolution decision."}})

    process_completed = value.get("processCompleted")
    if not isinstance(process_completed, dict):
        raise ValidationError({"resolution": {"processCompleted": "Complete the process-completed checklist."}})
    invalid_process_fields = [key for key, checked in process_completed.items() if key not in RESOLUTION_PROCESS_FIELDS or not isinstance(checked, bool)]
    if invalid_process_fields:
        raise ValidationError({"resolution": {"processCompleted": "The process-completed checklist is invalid."}})
    process_completed = {key: process_completed.get(key, False) for key in RESOLUTION_PROCESS_FIELDS}
    if not any(process_completed.values()):
        raise ValidationError({"resolution": {"processCompleted": "Select the applicable process-completed items."}})
    if "All objectives met" in reasons and not process_completed["carePlanGoalsMet"]:
        raise ValidationError({"resolution": {"processCompleted": "Confirm that care plan goals have been met before selecting All objectives met."}})
    return {**value, "reasons": reasons, "processCompleted": process_completed}


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
        referral.get("briefCircumstances"),
        assessment.get("childOwnStory"),
        background.get("child_story_or_reported_circumstances"),
        assessment.get("historyAndCurrentSituation"),
        assessment.get("childSafetyNeeds"),
        assessment.get("familyFunctioning"),
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

    child_sex = first_text(child.get("sex"), getattr(alert, "sex", ""), fallback="")
    referral_agency = first_text(referral.get("referralAgency"), referral.get("referredTo"), fallback="")
    return f"""
    <html><head><meta charset="utf-8" />
    <style>
      @page {{ size: A4; margin: 10mm 13mm 12mm; }}
      * {{ box-sizing: border-box; }} body {{ margin: 0; font-family: Arial, sans-serif; color: #111; font-size: 10.5pt; line-height: 1.24; }}
      .official-header {{ text-align: center; margin-bottom: 7mm; }} .logo {{ width: 48px; height: 48px; object-fit: contain; margin: 0 auto 2px; }}
      .ministry {{ margin: 0; color: #082f49; font-size: 11pt; font-weight: 700; text-transform: uppercase; }} .system {{ margin: 1px 0; color: #0f5d62; font-size: 8pt; font-weight: 700; letter-spacing: .5px; text-transform: uppercase; }}
      .form-title {{ margin: 4px 0 0; color: #082f49; font-size: 13pt; font-weight: 700; letter-spacing: .35px; }} .topline {{ display: table; width: 100%; margin: 2mm 0 5mm; font-weight: 700; }} .topline span {{ display: table-cell; }} .topline span:nth-child(2) {{ text-align: center; }} .topline span:last-child {{ text-align: right; }}
      .section {{ margin-top: 5mm; font-size: 11pt; font-weight: 700; text-transform: uppercase; }} .line {{ display: inline; min-width: 0; border: 0; padding: 0; color: #263747; font-weight: 600; text-transform: none; }} .wide, .medium, .short {{ min-width: 0; }}
      .child-line {{ white-space: nowrap; }} .child-line .name {{ min-width: 46mm; }} .child-line .id {{ min-width: 88mm; }}
      table {{ width: 100%; border-collapse: collapse; margin-top: 3mm; }} th, td {{ border: 1px solid #111; padding: 5px 7px; text-align: left; vertical-align: top; }} th {{ background: #d9d9d9; font-weight: 700; }} .guardian-head th {{ font-size: 10.5pt; }} .guardian td:first-child {{ width: 18%; }} .guardian td:nth-child(2) {{ width: 32%; }} .guardian td:nth-child(3) {{ width: 18%; }} .guardian td:nth-child(4) {{ width: 32%; }}
      .narrative {{ margin: 2mm 0 4mm; min-height: 12mm; white-space: pre-wrap; border-left: 3px solid #0f5d62; background: #f8fafc; padding: 3mm 4mm; line-height: 1.38; }}
      .detail-line {{ margin: 2mm 0; }} .recipient-block {{ break-inside: avoid; }} .signature-line {{ display: inline-block; min-width: 92mm; height: 6mm; border-bottom: 1px solid #111; vertical-align: bottom; }} .follow-up {{ margin-top: 7mm; color: #082f49; font-size: 11pt; font-weight: 700; }} .check {{ display: inline-block; width: 14px; height: 14px; border: 1px solid #111; vertical-align: middle; margin-left: 6px; }} .break {{ break-before: page; }}
    </style></head><body>
      <header class="official-header">{logo_html}<p class="ministry">Ministry of Public Service, Labour and Social Welfare</p><p class="system">National Case Management Information System</p><p class="form-title">REFERRAL FORM</p></header>
      <div class="topline"><span>Confidential</span><span>File No. {html_text(intake.temporary_case_reference)}</span><span>Date: {html_text(referral_date)}</span></div>
      <div class="section">1. Child Details</div>
      <p class="child-line">Surname: <span class="line name">{html_text(first_text(child.get("surname"), getattr(alert, "child_surname", ""), fallback=""))}</span> &nbsp; First Names: <span class="line name">{html_text(first_text(child.get("first_names"), getattr(alert, "child_first_name", ""), fallback=""))}</span></p>
      <p class="child-line">ID Number: <span class="line id">{html_text(child_birth_id)}</span> &nbsp; Sex: <span class="line short">{html_text(child_sex)}</span></p>
      <div class="section">2. Parent / Guardian Details</div>
      <table class="guardian"><tr><th colspan="4">Parents* or Guardians</th></tr><tr class="guardian-head"><th colspan="2">Father*/male guardian</th><th colspan="2">Mother*/female guardian</th></tr><tr><td>Surname</td><td>{html_text(father.get("surname") if father else "")}</td><td>Surname</td><td>{html_text(mother.get("surname") if mother else "")}</td></tr><tr><td>First Name</td><td>{html_text(father.get("first_names") if father else "")}</td><td>First Name</td><td>{html_text(mother.get("first_names") if mother else "")}</td></tr><tr><td>Address</td><td>{html_text(father.get("address") if father else "")}</td><td>Address</td><td>{html_text(mother.get("address") if mother else "")}</td></tr><tr><td>Telephone</td><td>{html_text(father.get("telephone") if father else "")}</td><td>Telephone</td><td>{html_text(mother.get("telephone") if mother else "")}</td></tr></table>
      <div class="section">3. Brief Circumstances of Child:</div><div class="narrative">{html_text(circumstances, fallback="")}</div>
      <div class="section">4. Reason for Referral:</div><div class="narrative">{html_text(referral.get("reason"), fallback="")}</div>
      <div class="section">5. Referred By</div>
      <div class="detail-line">Referred By (Name): <span class="line medium">{html_text(user_display_name(officer))}</span> Designation: <span class="line medium">{html_text(user_designation(officer))}</span></div><div class="detail-line">Organization: <span class="line wide">{html_text(officer_org)}</span></div><div class="detail-line">Address: <span class="line wide">{html_text(district)}</span></div><div class="detail-line">Contact Details: <span class="line wide">{html_text(officer_contact)}</span></div>
      <div class="recipient-block"><div class="detail-line" style="margin-top:8mm">Referral sent to: <span class="line wide">{html_text(referral_agency)}</span></div><div class="detail-line">Address: <span class="line wide">{html_text(referral.get("address"))}</span></div><div class="detail-line">Contact Details: <span class="line wide">{html_text(first_text(referral.get("telephone"), referral.get("contactDetails")))}</span></div>
      <div class="detail-line" style="margin-top:6mm">Responsible Referring Signature: <span class="signature-line"></span></div>
      <div class="follow-up">Follow-up (to be sent back to referring agency)</div><p>Phone or written confirmation that referral is received and accepted <i>(please check)</i><span class="check"></span></p><div class="detail-line">Date seen: <span class="line short"></span> &nbsp; Date reported back to referring organization: <span class="line medium"></span></div><div class="detail-line">Action Taken/Services Provided: <span class="line wide"></span></div><div class="detail-line">&nbsp;<span class="line wide"></span></div><div class="detail-line" style="margin-top:8mm">Name, title: <span class="line medium"></span> Signature: <span class="line medium"></span></div></div>
    </body></html>"""


SUPERVISOR_ROLES = {UserProfile.Role.DISTRICT_HEAD} | (NATIONAL_ROLES - {UserProfile.Role.SYS_ADMIN})
FINAL_ALERT_STATUSES = {
    Alert.Status.CONVERTED,
    Alert.Status.SUPERVISOR_REVIEW,
    Alert.Status.APPROVED_ALLOCATION,
    Alert.Status.ALLOCATED,
    Alert.Status.REJECTED,
    Alert.Status.RESOLVED,
    Alert.Status.DUPLICATE,
    Alert.Status.REFERRED,
}


def has_role(user, roles):
    if not user or not user.is_authenticated:
        return False
    if user.is_superuser and UserProfile.Role.SYS_ADMIN in roles:
        return True
    return hasattr(user, "profile") and user.profile.active and user.profile.role in roles


def is_profile_system_admin(user):
    """Use the operational profile—not a legacy Django flag—for write locks."""
    profile = getattr(user, "profile", None)
    if profile and profile.active:
        return profile.role == UserProfile.Role.SYS_ADMIN
    return bool(user.is_superuser)


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
        raise ValueError("A district with a 2- or 3-letter code is required before a case number can be generated.")
    code = (district.code or "").strip().upper()
    if len(code) not in {2, 3} or not code.isalpha():
        raise ValueError("District code must be 2 or 3 letters before a case number can be generated.")
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
    return f"{code}/CW/{number}/{year % 100:02d}"


def notification_recipients(roles, district=None, province=None, exclude_user=None):
    qs = User.objects.select_related("profile").filter(is_active=True, profile__active=True, profile__role__in=roles)
    if district:
        qs = qs.filter(profile__district=district)
    elif province:
        qs = qs.filter(profile__province=province)
    if exclude_user:
        qs = qs.exclude(id=exclude_user.id)
    return qs


def create_notification(recipient, *, title, message, category, priority, target_type, target_id, action_label, route, dedupe_key, due_at=None):
    notification, created = Notification.objects.get_or_create(
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
    )
    if created:
        return notification
    updates = {
        "title": title,
        "message": message,
        "category": category,
        "priority": priority,
        "target_type": target_type,
        "target_id": str(target_id),
        "action_label": action_label,
        "route": route,
        "due_at": due_at,
        "resolved_at": None,
    }
    changed_fields = [field for field, value in updates.items() if getattr(notification, field) != value]
    if changed_fields:
        for field, value in updates.items():
            setattr(notification, field, value)
        notification.read_at = None
        notification.save(update_fields=[*changed_fields, "read_at", "updated_at"])
    return notification


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
    first_reminder_at = timedelta(hours=7)
    reminder_lifetime = timedelta(days=7)
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
        reminder_qs = Notification.objects.filter(
            recipient=user,
            target_type="case",
            target_id=str(intake.id),
            dedupe_key__icontains="emergency-draft-reminder",
            resolved_at__isnull=True,
        )
        if elapsed >= reminder_lifetime:
            reminder_qs.update(resolved_at=now)
            continue
        if elapsed < first_reminder_at:
            continue
        due_at = anchor + timedelta(hours=48)
        opening = intake.opening_summary or {}
        child_profile = intake.child_profile_draft or {}
        child = " ".join(str(child_profile.get(key) or "").strip() for key in ("first_names", "surname")).strip() or "Unknown child"
        classification = "Immediate danger" if intake.is_immediate_danger else "Emergency"
        dedupe_key = f"intake:{intake.id}:emergency-draft-reminder"
        is_supervisor_escalation = user.id != intake.created_by_id and elapsed >= timedelta(hours=72)
        if elapsed >= timedelta(hours=72):
            reminder_stage = "Escalated after 72 hours"
        elif elapsed >= timedelta(hours=48):
            reminder_stage = "Overdue"
        else:
            reminder_stage = "Action required before the deadline"
        notification = create_notification(
            user,
            title=f"{classification} draft still pending",
            message=f"{intake_case_reference(intake)} | Child: {child} | {reminder_stage}. This reminder will automatically end seven days after the draft was created.",
            category="Intake",
            priority="escalated" if is_supervisor_escalation else "critical" if intake.is_immediate_danger else "warning",
            target_type="case",
            target_id=intake.id,
            action_label="Open draft",
            route="case-intake",
            due_at=due_at,
            dedupe_key=dedupe_key,
        )
        reminder_qs.exclude(pk=notification.pk).update(resolved_at=now)


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
        title="Immediate danger case awaiting allocation" if is_immediate else "Emergency case awaiting allocation" if is_emergency else "Case awaiting allocation",
        message=(
            f"{intake_case_reference(intake)} | Child: {child} | District: {district.name if district else 'Not captured'} | "
            f"Officer: {officer} | Classification: {classification} | Submitted: {submitted_at}"
        ),
        category="Allocation",
        priority="critical" if is_immediate else "warning" if is_emergency else "warning",
        target_type="case",
        target_id=intake.id,
        action_label="Allocate case",
        route="allocation",
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
        message=f"{intake_case_reference(intake)} is approved and needs assignment to an SDO.",
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
        action_label="Open allocated case",
        route="allocated-cases",
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


def notify_assessment_care_plan_reviewed(intake, *, stage, decision):
    """Tell the allocated SDO when they can continue or must revise the package."""
    if not intake.allocated_officer_id:
        return
    approved = stage == "care_plan" and decision in {"approve", "approve_with_comments"}
    if approved:
        title = "Assessment and care plan approved"
        message = f"{intake_case_reference(intake)} has been approved. You can now continue with court orders, referrals, implementation, monitoring, case notes, attachments and resolution."
        priority = "info"
        action_label = "Continue case"
    else:
        reviewed_stage = "assessment" if stage == "assessment" else "care plan"
        title = "Assessment returned for revision" if stage == "assessment" else "Care plan returned for revision"
        message = f"{intake_case_reference(intake)} {reviewed_stage} requires revision before the case can proceed."
        if intake.assessment_care_plan_review_notes:
            message += f" DSDO comments: {intake.assessment_care_plan_review_notes}"
        priority = "warning"
        action_label = "Revise submission"
    create_notification(
        intake.allocated_officer,
        title=title,
        message=message,
        category="Care Plan",
        priority=priority,
        target_type="case",
        target_id=intake.id,
        action_label=action_label,
        route="allocated-cases",
        dedupe_key=f"intake:{intake.id}:assessment-care-plan-review:{stage}:{decision}",
    )


def notify_care_plan_change_requested(intake, requested_by):
    district = intake.alert.district if intake.alert_id else getattr(intake.created_by.profile, "district", None)
    recipients = notification_recipients([UserProfile.Role.DISTRICT_HEAD], district=district, exclude_user=requested_by)
    notify_users(
        recipients,
        title="Care plan change requested",
        message=f"{intake_case_reference(intake)} has a care plan change awaiting DSDO approval.",
        category="Care Plan",
        priority="warning",
        target_type="case",
        target_id=intake.id,
        action_label="Review change request",
        route="update-requests",
        dedupe_key=f"intake:{intake.id}:care-plan-change-request",
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


class NationalDashboardView(APIView):
    """Executive national caseload summary for head-office roles only."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        return management_dashboard_response(request, "national")

        # Retained temporarily below for migration safety; the shared scoped
        # dashboard service above is authoritative for all management levels.
        if not has_role(request.user, NATIONAL_ROLES):
            return Response({"detail": "National dashboard access is restricted to national users."}, status=status.HTTP_403_FORBIDDEN)

        try:
            months = int(request.query_params.get("months", 6))
        except (TypeError, ValueError):
            months = 6
        months = 12 if months == 12 else 6
        now = timezone.now()
        today = timezone.localdate()
        intakes = list(Intake.objects.select_related(
            "alert__district__province", "created_by__profile__district__province"
        ).all())
        provinces = list(Province.objects.filter(status="Active").order_by("name"))

        def province_for(intake):
            district = intake.alert.district if intake.alert_id else getattr(getattr(intake.created_by, "profile", None), "district", None)
            return district.province if district else None

        def resolved(intake):
            return intake.status == Intake.Status.RESOLVED or intake.resolution_status == "Resolved"

        def high_risk(intake):
            return str(intake.risk_level or intake.priority_level).upper() in {"HIGH", "CRITICAL"}

        def workflow_stage(intake):
            # Screening and allocation are intake activities, not separate case
            # lifecycle stages. Once allocated, the case moves to assessment.
            if not intake.allocated_at:
                return "Intake"
            if not intake.assessment_completed_at:
                return "Assessment"
            if intake.assessment_care_plan_status not in {"Approved", "Approved with Comments"}:
                return "Care Plan"
            if intake.monitoring_followups_draft:
                return "Monitoring"
            return "Care Plan Implementation"

        active = [item for item in intakes if not resolved(item)]
        active_refs = {item.temporary_case_reference for item in active}
        overdue_refs = {
            item.temporary_case_reference for item in active
            if item.allocated_at and not item.assessment_completed_at and item.allocated_at + timedelta(days=7) < now
        }
        overdue_tasks = CalendarTask.objects.select_related("district__province").filter(date__lt=today, source__in=active_refs)
        overdue_refs.update(overdue_tasks.values_list("source", flat=True))

        periods = []
        year, month = today.year, today.month
        for offset in reversed(range(months)):
            absolute_month = year * 12 + month - 1 - offset
            period_year, zero_month = divmod(absolute_month, 12)
            period_month = zero_month + 1
            periods.append({
                "key": f"{period_year:04d}-{period_month:02d}",
                "label": f"{calendar.month_abbr[period_month]} {str(period_year)[2:]}",
                "received": 0,
                "resolved": 0,
            })
        trend_by_key = {period["key"]: period for period in periods}
        for intake in intakes:
            created_key = intake.created_at.strftime("%Y-%m")
            if created_key in trend_by_key:
                trend_by_key[created_key]["received"] += 1
            if resolved(intake):
                resolved_at = intake.resolution_reviewed_at or intake.updated_at
                resolved_key = resolved_at.strftime("%Y-%m")
                if resolved_key in trend_by_key:
                    trend_by_key[resolved_key]["resolved"] += 1

        stages = defaultdict(int)
        for intake in active:
            stages[workflow_stage(intake)] += 1
        stage_order = ["Intake", "Assessment", "Care Plan", "Care Plan Implementation", "Monitoring"]

        province_rows = []
        for province in provinces:
            province_intakes = [item for item in intakes if getattr(province_for(item), "id", None) == province.id]
            province_active = [item for item in province_intakes if not resolved(item)]
            district_rows = []
            for district in District.objects.filter(province=province, status="Active").order_by("name"):
                district_intakes = [item for item in province_intakes if (
                    (item.alert.district_id if item.alert_id else getattr(getattr(item.created_by, "profile", None), "district_id", None)) == district.id
                )]
                district_active = [item for item in district_intakes if not resolved(item)]
                district_rows.append({
                    "id": district.id,
                    "district": district.name,
                    "active": len(district_active),
                    "highCritical": sum(high_risk(item) for item in district_active),
                    "overdue": sum(item.temporary_case_reference in overdue_refs for item in district_active),
                    "resolved": sum(resolved(item) for item in district_intakes),
                })
            province_rows.append({
                "id": province.id,
                "province": province.name,
                "active": len(province_active),
                "highCritical": sum(high_risk(item) for item in province_active),
                "overdue": sum(item.temporary_case_reference in overdue_refs for item in province_active),
                "resolved": sum(resolved(item) for item in province_intakes),
                "districts": district_rows,
            })

        month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        return Response({
            "generatedAt": now.isoformat(),
            "periodMonths": months,
            "kpis": {
                "active": len(active),
                "newCases": sum(item.created_at >= month_start for item in intakes),
                "highCritical": sum(high_risk(item) for item in active),
                "overdue": len(overdue_refs),
            },
            "trend": periods,
            "stages": [{"name": name, "value": stages[name]} for name in stage_order],
            "provinces": province_rows,
        })


def management_intake_district(intake):
    if intake.alert_id and intake.alert.district_id:
        return intake.alert.district
    return getattr(getattr(intake.created_by, "profile", None), "district", None)


def management_case_resolved(intake):
    return intake.status == Intake.Status.RESOLVED or intake.resolution_status == "Resolved"


def management_case_stage(intake):
    if not intake.allocated_at:
        return "Intake"
    if not intake.assessment_completed_at:
        return "Assessment"
    if intake.assessment_care_plan_status not in {"Approved", "Approved with Comments", "Completed"}:
        return "Care Plan"
    if intake.monitoring_followups_draft:
        return "Monitoring"
    return "Care Plan Implementation"


def management_dashboard_response(request, scope_type, scope_id=None):
    user = request.user
    profile = getattr(user, "profile", None)
    role = getattr(profile, "role", None)
    is_national = user.is_superuser or role in NATIONAL_ROLES
    province = None
    district = None
    officer = None

    if scope_type == "national":
        if not is_national:
            return Response({"detail": "National dashboard access is restricted to national users."}, status=status.HTTP_403_FORBIDDEN)
    elif scope_type == "province":
        province = Province.objects.filter(pk=scope_id, status="Active").first()
        if not province:
            return Response({"detail": "Province not found."}, status=status.HTTP_404_NOT_FOUND)
        if not is_national and not (role == UserProfile.Role.PROVINCIAL_HEAD and profile.province_id == province.id):
            return Response({"detail": "You do not have access to this Province."}, status=status.HTTP_403_FORBIDDEN)
    elif scope_type == "district":
        district = District.objects.select_related("province").filter(pk=scope_id, status="Active").first()
        if not district:
            return Response({"detail": "District not found."}, status=status.HTTP_404_NOT_FOUND)
        allowed = is_national or (role == UserProfile.Role.PROVINCIAL_HEAD and profile.province_id == district.province_id) or (role == UserProfile.Role.DISTRICT_HEAD and profile.district_id == district.id)
        if not allowed:
            return Response({"detail": "You do not have access to this District."}, status=status.HTTP_403_FORBIDDEN)
        province = district.province
    elif scope_type == "officer":
        officer = User.objects.select_related("profile__district__province").filter(pk=scope_id, profile__role=UserProfile.Role.DSDO, profile__active=True).first()
        if not officer or not officer.profile.district_id:
            return Response({"detail": "Officer not found."}, status=status.HTTP_404_NOT_FOUND)
        district = officer.profile.district
        province = district.province
        allowed = is_national or (role == UserProfile.Role.PROVINCIAL_HEAD and profile.province_id == province.id) or (role == UserProfile.Role.DISTRICT_HEAD and profile.district_id == district.id)
        if not allowed:
            return Response({"detail": "You do not have access to this Officer."}, status=status.HTTP_403_FORBIDDEN)
    else:
        return Response({"detail": "Unsupported dashboard scope."}, status=status.HTTP_400_BAD_REQUEST)

    try:
        months = 12 if int(request.query_params.get("months", 6)) == 12 else 6
    except (TypeError, ValueError):
        months = 6
    now = timezone.now()
    today = timezone.localdate()
    all_intakes = list(Intake.objects.select_related(
        "alert__district__province", "created_by__profile__district__province", "allocated_officer__profile__district__province"
    ).all())
    if province:
        all_intakes = [item for item in all_intakes if getattr(management_intake_district(item), "province_id", None) == province.id]
    if district:
        all_intakes = [item for item in all_intakes if getattr(management_intake_district(item), "id", None) == district.id]
    if officer:
        all_intakes = [item for item in all_intakes if item.allocated_officer_id == officer.id]

    active = [item for item in all_intakes if not management_case_resolved(item)]
    active_refs = {item.temporary_case_reference for item in active}
    overdue_refs = {
        item.temporary_case_reference for item in active
        if item.allocated_at and not item.assessment_completed_at and item.allocated_at + timedelta(days=7) < now
    }
    overdue_refs.update(CalendarTask.objects.filter(date__lt=today, source__in=active_refs).values_list("source", flat=True))
    for item in active:
        for record in item.monitoring_followups_draft or []:
            due = record.get("nextFollowUpDate") or record.get("next_follow_up_date") if isinstance(record, dict) else None
            if due and str(due) < today.isoformat():
                overdue_refs.add(item.temporary_case_reference)

    periods = []
    year, month = today.year, today.month
    for offset in reversed(range(months)):
        absolute_month = year * 12 + month - 1 - offset
        period_year, zero_month = divmod(absolute_month, 12)
        period_month = zero_month + 1
        periods.append({"key": f"{period_year:04d}-{period_month:02d}", "label": f"{calendar.month_abbr[period_month]} {str(period_year)[2:]}", "received": 0, "implementation": 0, "completed": 0})
    trend = {row["key"]: row for row in periods}
    for item in all_intakes:
        for field, key in ((item.created_at, "received"), (item.care_plan_implementation_started_at, "implementation"), (item.care_plan_implementation_completed_at, "completed")):
            if field and field.strftime("%Y-%m") in trend:
                trend[field.strftime("%Y-%m")][key] += 1

    stage_names = ["Intake", "Assessment", "Care Plan", "Care Plan Implementation", "Monitoring"]
    stage_counts = defaultdict(int)
    for item in active:
        stage_counts[management_case_stage(item)] += 1

    def summary(items):
        active_items = [item for item in items if not management_case_resolved(item)]
        return {
            "active": len(active_items),
            "highCritical": sum(str(item.risk_level or item.priority_level).upper() in {"HIGH", "CRITICAL"} for item in active_items),
            "overdue": sum(item.temporary_case_reference in overdue_refs for item in active_items),
            "completed": sum(bool(item.care_plan_implementation_completed_at) for item in items),
        }

    children = []
    if scope_type == "national":
        for child in Province.objects.filter(status="Active").order_by("name"):
            items = [item for item in all_intakes if getattr(management_intake_district(item), "province_id", None) == child.id]
            children.append({"id": child.id, "name": child.name, **summary(items)})
    elif scope_type == "province":
        for child in District.objects.filter(province=province, status="Active").order_by("name"):
            items = [item for item in all_intakes if getattr(management_intake_district(item), "id", None) == child.id]
            children.append({"id": child.id, "name": child.name, **summary(items)})
    elif scope_type == "district":
        officers = User.objects.select_related("profile").filter(profile__district=district, profile__role=UserProfile.Role.DSDO, profile__active=True, is_active=True).order_by("first_name", "last_name", "username")
        for child in officers:
            items = [item for item in all_intakes if item.allocated_officer_id == child.id]
            children.append({"id": child.id, "name": child.get_full_name() or child.username, "role": child.profile.get_role_display(), **summary(items)})

    case_rows = []
    if scope_type == "officer":
        for item in active:
            case_rows.append({
                "id": item.id,
                "reference": item.temporary_case_reference,
                "caseType": item.case_category or "Uncategorized",
                "priority": item.risk_level or item.priority_level,
                "stage": management_case_stage(item),
                "dueStatus": "Overdue" if item.temporary_case_reference in overdue_refs else "On Track",
                "dateReceived": item.created_at.isoformat(),
                "lastActivity": item.updated_at.isoformat(),
            })

    scope_name = "National Overview" if scope_type == "national" else officer.get_full_name() or officer.username if officer else district.name if district else province.name
    breadcrumbs = [{"type": "national", "id": None, "name": "National Overview"}]
    if province:
        breadcrumbs.append({"type": "province", "id": province.id, "name": province.name})
    if district:
        breadcrumbs.append({"type": "district", "id": district.id, "name": district.name})
    if officer:
        breadcrumbs.append({"type": "officer", "id": officer.id, "name": officer.get_full_name() or officer.username})
    result = summary(all_intakes)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    return Response({
        "generatedAt": now.isoformat(), "periodMonths": months,
        "scope": {"type": scope_type, "id": scope_id, "name": scope_name, "provinceName": province.name if province else "", "districtName": district.name if district else "", "role": officer.profile.get_role_display() if officer else ""},
        "breadcrumbs": breadcrumbs,
        "kpis": {**result, "newCases": sum(item.created_at >= month_start for item in all_intakes)},
        "trend": periods,
        "stages": [{"name": name, "value": stage_counts[name]} for name in stage_names],
        "children": children, "cases": case_rows,
    })


class ProvinceDashboardView(APIView):
    permission_classes = [IsAuthenticated]
    def get(self, request, province_id):
        return management_dashboard_response(request, "province", province_id)


class DistrictDashboardView(APIView):
    permission_classes = [IsAuthenticated]
    def get(self, request, district_id):
        return management_dashboard_response(request, "district", district_id)


class OfficerDashboardView(APIView):
    permission_classes = [IsAuthenticated]
    def get(self, request, officer_id):
        return management_dashboard_response(request, "officer", officer_id)


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
            "resolvedCases": "Cases resolved",
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
            "review-resolution": [
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
    # Keep the management table stable across navigation and put newly-created
    # accounts on the first page.  Without an explicit ordering Django returns
    # the database's incidental order (normally oldest IDs first), while the
    # client temporarily inserts a saved user at the top.  Re-opening the view
    # then made that user appear to have disappeared.
    queryset = (
        User.objects.select_related("profile", "profile__organization", "profile__province", "profile__district", "profile__ward")
        .all()
        .order_by("-date_joined", "-id")
    )

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
        if request.method not in SAFE_METHODS and is_profile_system_admin(request.user):
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
                    return Response({"detail": "Provide a reason before resolving an invalid alert."}, status=status.HTTP_400_BAD_REQUEST)
                alert.validity_decision = Alert.ValidityDecision.INVALID
                alert.invalid_reason = reason
                alert.status = Alert.Status.RESOLVED
                alert.internal_status = "Resolved - No Further Action"
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
            alert.internal_status = "Resolved - Referred Externally"
        elif action_name == "resolve":
            alert.status = Alert.Status.RESOLVED
            alert.internal_status = "Resolved - No Further Action"
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
                intake_source="ALERT_REFERRAL",
                original_alert_snapshot={
                    "alert_id": alert.reference,
                    "date_reported": alert.created_at.isoformat() if alert.created_at else "",
                    "reporter_name": alert.reporter.get_full_name() or alert.reporter.username,
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
                    "perpetrator_has_access": alert.perpetrator_has_access,
                    "referred_to_police": alert.referred_to_police,
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
                    "source": "Alert Referral",
                    "alert_id": alert.reference,
                    "alert_referred_at": timezone.now().isoformat(),
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
                    "immediate_danger_reported": "Yes" if alert.is_immediate_danger else "No",
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
                    },
                    "screening_draft": {
                        "selected_categories": alert.concern_categories,
                        "alleged_perpetrator_known": alert.alleged_perpetrator_known,
                        "accused_name": alert.alleged_perpetrator_name,
                        "accused_relationship_to_child": alert.alleged_perpetrator_relationship,
                        "accused_sex": alert.alleged_perpetrator_sex,
                        "accused_race": alert.alleged_perpetrator_race,
                        "referred_to_police": alert.referred_to_police,
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
                    "address_of_child": alert.home_address,
                    "district": alert.district.name if alert.district else "",
                    "ward": alert.ward.name if alert.ward else "",
                },
                household_profile_draft={
                    "caregiver_name": alert.caregiver_name,
                    "caregiver_contact": alert.caregiver_contact,
                    "home_address": alert.home_address,
                },
                background_information={
                    "other_background_information": alert.description,
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
    queryset = Intake.objects.select_related(
        "alert",
        "alert__district",
        "allocated_officer",
        "allocated_by",
        "reviewed_by",
        "created_by",
        "created_by__profile",
        "created_by__profile__district",
        "created_by__profile__province",
    ).order_by("-created_at", "-id")

    def get_queryset(self):
        user = self.request.user
        qs = self.queryset
        if has_role(user, NATIONAL_ROLES):
            return qs
        if has_role(user, {UserProfile.Role.DISTRICT_HEAD}):
            return qs.filter(
                Q(alert__district=user.profile.district)
                | Q(alert__isnull=True, created_by__profile__district=user.profile.district)
            ) if user.profile.district_id else qs.none()
        if has_role(user, {UserProfile.Role.DSDO}):
            return qs.filter(Q(alert__district=user.profile.district) | Q(alert__isnull=True, created_by=user)) if user.profile.district_id else qs.filter(alert__isnull=True, created_by=user)
        if has_role(user, PROVINCIAL_ROLES):
            return qs.filter(
                Q(alert__district__province=user.profile.province)
                | Q(alert__isnull=True, created_by__profile__province=user.profile.province)
            ) if user.profile.province_id else qs.none()
        return qs.none()

    def perform_update(self, serializer):
        previous = self.get_object()
        previous_status = previous.status
        previous_classification = previous.emergency_classification
        if "case_notes_draft" in serializer.validated_data:
            if self.request.user != previous.allocated_officer and not has_role(self.request.user, SUPERVISOR_ROLES):
                raise PermissionDenied("Only the allocated officer or a supervisor can manage case notes.")
            serializer.validated_data["case_notes_draft"] = reconcile_case_notes_draft(
                previous.case_notes_draft,
                serializer.validated_data["case_notes_draft"],
            )
        if "justice_draft" in serializer.validated_data:
            serializer.validated_data["justice_draft"] = clean_justice_draft(
                serializer.validated_data["justice_draft"],
                intake_case_reference(previous),
            )
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
        source = self.request.data.get("intake_source") or "DIRECT_INTAKE"
        if source in {"WALK_IN", "DIRECT_INTAKE"}:
            source = "DIRECT_INTAKE"
            child = self.request.data.get("child_profile_draft") or {}
            child_values = child.values() if isinstance(child, dict) else []
            if not any(str(value or "").strip() for value in child_values):
                raise ValidationError({"detail": "Complete Child Details before the first autosave. A case number has not been assigned."})
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
        screening_draft = request.data.get("screening_draft")
        existing_screening = (intake.opening_summary or {}).get("screening_draft") or {}
        selected_case_types = (
            screening_draft.get("selected_categories")
            if isinstance(screening_draft, dict) and "selected_categories" in screening_draft
            else existing_screening.get("selected_categories")
        )
        if not isinstance(selected_case_types, list) or not any(str(value or "").strip() for value in selected_case_types):
            return Response(
                {"case_type": "Select at least one case type on the Case Summary before submitting this case."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        intake.case_category = request.data.get("case_category", intake.case_category)
        intake.risk_level = request.data.get("risk_level", intake.risk_level)
        if isinstance(screening_draft, dict):
            opening_summary = intake.opening_summary or {}
            existing_screening = opening_summary.get("screening_draft") or {}
            opening_summary["screening_draft"] = {**existing_screening, **screening_draft}
            intake.opening_summary = opening_summary
            immediate_danger = screening_draft.get("immediate_danger")
            if immediate_danger in {"Yes", "No"}:
                intake.is_immediate_danger = immediate_danger == "Yes"
            if intake.is_immediate_danger:
                intake.risk_level = "Critical"
                intake.priority_level = "Critical"
                intake.emergency_classification = "EMERGENCY_IMMEDIATE_DANGER"
            elif intake.is_emergency:
                intake.priority_level = "Emergency"
                intake.emergency_classification = "EMERGENCY"
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
        if intake.status not in {Intake.Status.SUPERVISOR_REVIEW, Intake.Status.APPROVED}:
            return Response({"detail": "Only submitted or approved unallocated cases can be allocated."}, status=status.HTTP_400_BAD_REQUEST)
        district = intake.alert.district if intake.alert_id else getattr(intake.created_by.profile, "district", None)
        officer = User.objects.filter(
            id=request.data.get("officer_id"),
            profile__role=UserProfile.Role.DSDO,
            profile__district=district,
            profile__active=True,
        ).first()
        if not officer:
            return Response({"detail": "Select an active SDO from the case district."}, status=status.HTTP_400_BAD_REQUEST)
        automatically_reviewed = intake.status == Intake.Status.SUPERVISOR_REVIEW
        if automatically_reviewed:
            intake.reviewed_by = request.user
            intake.reviewed_at = timezone.now()
            intake.supervisor_notes = request.data.get("supervisor_notes", intake.supervisor_notes)
        intake.allocated_officer = officer
        intake.allocated_by = request.user
        intake.allocated_at = timezone.now()
        intake.status = Intake.Status.ALLOCATED
        intake.save()
        if intake.alert:
            intake.alert.status = Alert.Status.ALLOCATED
            intake.alert.internal_status = "Allocated to Case Officer"
            intake.alert.save()
        resolve_notifications("case", intake.id, "submitted-review")
        resolve_notifications("case", intake.id, "ready-allocation")
        notify_case_allocated(intake)
        allocation_delay_seconds = None
        if intake.screening_completed_at and intake.allocated_at:
            allocation_delay_seconds = max(0, int((intake.allocated_at - intake.screening_completed_at).total_seconds()))
        audit(request.user, "Case allocated", intake, {
            "officer": officer.username,
            "accepted_during_allocation": automatically_reviewed,
            "screening_completed_at": intake.screening_completed_at.isoformat() if intake.screening_completed_at else "",
            "allocated_at": intake.allocated_at.isoformat() if intake.allocated_at else "",
            "allocation_delay_seconds": allocation_delay_seconds,
        })
        return Response(IntakeSerializer(intake, context={"request": request}).data)

    @action(detail=True, methods=["post"], url_path="submit-care-plan")
    def submit_care_plan(self, request, pk=None):
        intake = self.get_object()
        if not intake.allocated_at or not intake.allocated_officer_id:
            return Response({"detail": "A care plan can only be submitted after allocation."}, status=status.HTTP_400_BAD_REQUEST)
        if request.user != intake.allocated_officer and not has_role(request.user, SUPERVISOR_ROLES):
            return Response({"detail": "Only the allocated officer can submit the care plan."}, status=status.HTTP_403_FORBIDDEN)
        if intake.assessment_care_plan_status in {"Approved", "Approved with Comments", "Change Pending Approval"}:
            return Response({"detail": "This care plan is already approved. Use Request Change for any new or updated activity."}, status=status.HTTP_409_CONFLICT)
        assessment = clean_assessment_draft(request.data.get("assessment") or {})
        care_plan = clean_care_plan_draft(request.data.get("care_plan") or {})
        care_plan_versions = request.data.get("care_plan_versions") or []
        care_plan_change_logs = request.data.get("care_plan_change_logs") or []
        case_conferences = request.data.get("case_conferences") or []
        justice = clean_justice_draft(request.data.get("justice") or {}, intake_case_reference(intake))
        referrals = clean_referrals_draft(request.data.get("referrals") or [])
        service_tracking = clean_service_tracking(request.data.get("service_tracking") or [], care_plan)
        case_notes = reconcile_case_notes_draft(intake.case_notes_draft, request.data.get("case_notes") or [])
        case_documents = request.data.get("case_documents") or []
        monitoring_followups = clean_monitoring_followups(request.data.get("monitoring_followups") or [])
        if not care_plan.get("items"):
            return Response({"detail": "A care plan is required for submission."}, status=status.HTTP_400_BAD_REQUEST)
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
        # Submitting a care plan means the assessment it is based on has been
        # completed.  Preserve an earlier completion timestamp when present.
        if not intake.assessment_completed_at:
            intake.assessment_completed_at = now
        intake.assessment_care_plan_status = "Assessment Approved" if intake.assessment_care_plan_status == "Care Plan Revision Requested" else "Submitted"
        intake.assessment_care_plan_submitted_at = now
        intake.assessment_care_plan_submitted_by = request.user
        intake.save()
        audit(request.user, "Assessment and care plan submitted", intake)
        notify_assessment_care_plan_submitted(intake)
        return Response(IntakeSerializer(intake, context={"request": request}).data)

    @action(detail=True, methods=["post"], url_path="save-execution-draft")
    def save_execution_draft(self, request, pk=None):
        intake = self.get_object()
        approved_care_plan = intake.assessment_care_plan_status in {"Approved", "Approved with Comments"}
        if intake.resolution_status == "Resolved":
            return Response({"detail": "This case is resolved and its workflow records are locked."}, status=status.HTTP_400_BAD_REQUEST)
        if not intake.allocated_at or not intake.allocated_officer_id:
            return Response({"detail": "Case execution drafts can only be saved after allocation."}, status=status.HTTP_400_BAD_REQUEST)
        if request.user != intake.allocated_officer and not has_role(request.user, SUPERVISOR_ROLES):
            return Response({"detail": "Only the allocated officer or a supervisor can save this case draft."}, status=status.HTTP_403_FORBIDDEN)
        if request.user == intake.allocated_officer and intake.assessment_care_plan_status in {"Submitted", "Assessment Approved"}:
            return Response({"detail": "This case is locked while the assessment and care plan are awaiting supervisor approval."}, status=status.HTTP_423_LOCKED)

        intake.assessment_draft = clean_assessment_draft(request.data.get("assessment", intake.assessment_draft or {}))
        if request.data.get("assessment_completed") is True and not intake.assessment_completed_at:
            intake.assessment_completed_at = timezone.now()
        if not approved_care_plan:
            intake.care_plan_draft = clean_care_plan_draft(request.data.get("care_plan", intake.care_plan_draft or {}))
        if not approved_care_plan:
            intake.care_plan_versions_draft = request.data.get("care_plan_versions", intake.care_plan_versions_draft or [])
            intake.care_plan_change_logs_draft = request.data.get("care_plan_change_logs", intake.care_plan_change_logs_draft or [])
        intake.case_conferences_draft = request.data.get("case_conferences", intake.case_conferences_draft or [])
        intake.justice_draft = clean_justice_draft(
            request.data.get("justice", intake.justice_draft or {}),
            intake_case_reference(intake),
        )
        intake.referrals_draft = clean_referrals_draft(request.data.get("referrals", intake.referrals_draft or []))
        intake.service_tracking_draft = clean_service_tracking(
            request.data.get("service_tracking", intake.service_tracking_draft or []), intake.care_plan_draft
        )
        implementation_rows = [row for row in intake.service_tracking_draft if isinstance(row, dict)]
        implementation_started = any(
            row.get("implementationNotes") or row.get("status") in {"Referred", "In Progress", "Completed"}
            for row in implementation_rows
        )
        implementation_completed = (
            bool(implementation_rows)
            and any(row.get("status") == "Completed" for row in implementation_rows)
            and all(row.get("status") in {"Completed", "Cancelled"} for row in implementation_rows)
        )
        now = timezone.now()
        if approved_care_plan and implementation_started and not intake.care_plan_implementation_started_at:
            intake.care_plan_implementation_started_at = now
        if approved_care_plan and implementation_completed and not intake.care_plan_implementation_completed_at:
            intake.care_plan_implementation_completed_at = now
        elif not implementation_completed:
            intake.care_plan_implementation_completed_at = None
        missing_referrals = missing_required_referrals(intake.care_plan_draft, intake.referrals_draft, intake.service_tracking_draft)
        if missing_referrals:
            return Response({"detail": f"Create and send the required referral before progressing: {', '.join(missing_referrals)}."}, status=status.HTTP_400_BAD_REQUEST)
        intake.case_notes_draft = reconcile_case_notes_draft(
            intake.case_notes_draft,
            request.data.get("case_notes", intake.case_notes_draft or []),
        )
        intake.case_documents_draft = request.data.get("case_documents", intake.case_documents_draft or [])
        monitoring_followups = clean_monitoring_followups(request.data.get("monitoring_followups", intake.monitoring_followups_draft or []))
        existing_follow_up_count = len(intake.monitoring_followups_draft or [])
        new_follow_ups = monitoring_followups[existing_follow_up_count:]
        if new_follow_ups and (not implementation_allows_follow_up(intake.service_tracking_draft) or not all(follow_up_links_eligible_intervention(record, intake.service_tracking_draft) for record in new_follow_ups)):
            return Response({"detail": "Each follow-up must select a Referred, In Progress, or Completed care plan activity."}, status=status.HTTP_400_BAD_REQUEST)
        intake.monitoring_followups_draft = monitoring_followups
        care_plan_completed = request.data.get("care_plan_completed") is True
        has_care_plan_activity = bool(intake.care_plan_draft.get("items"))
        if care_plan_completed and not has_care_plan_activity:
            return Response({"detail": "Add at least one care plan activity before continuing."}, status=status.HTTP_400_BAD_REQUEST)
        if care_plan_completed:
            intake.assessment_care_plan_status = "Completed"
        elif not has_care_plan_activity and intake.assessment_care_plan_status == "Completed":
            intake.assessment_care_plan_status = "Draft"
        elif intake.assessment_care_plan_status in {"", "Submitted"}:
            intake.assessment_care_plan_status = "Draft"
        intake.save()
        audit(request.user, "Case execution draft saved", intake)
        return Response(IntakeSerializer(intake, context={"request": request}).data)

    @action(detail=True, methods=["post"], url_path="request-care-plan-change")
    def request_care_plan_change(self, request, pk=None):
        intake = self.get_object()
        if not intake.allocated_at or request.user != intake.allocated_officer:
            return Response({"detail": "Only the officer allocated to this case can request a care plan change."}, status=status.HTTP_403_FORBIDDEN)
        versions = request.data.get("care_plan_versions")
        change_logs = request.data.get("care_plan_change_logs")
        if not isinstance(versions, list) or not isinstance(change_logs, list):
            return Response({"detail": "The proposed care plan change is invalid."}, status=status.HTTP_400_BAD_REQUEST)
        pending_versions = [version for version in versions if isinstance(version, dict) and version.get("status") in {"Pending DSDO Approval", "Pending District Head Approval"}]
        if not pending_versions:
            return Response({"detail": "Add the proposed changes before sending the request."}, status=status.HTTP_400_BAD_REQUEST)
        if intake.assessment_care_plan_status not in {"Approved", "Approved with Comments", "Change Pending Approval"}:
            return Response({"detail": "Care plan changes can only be requested after the plan has been approved."}, status=status.HTTP_400_BAD_REQUEST)
        if UpdateRequest.objects.filter(intake=intake, tab="Care Plan", status=UpdateRequest.Status.PENDING).exists():
            return Response({"detail": "A care plan change request is already awaiting DSDO review."}, status=status.HTTP_400_BAD_REQUEST)
        pending_version = pending_versions[-1]
        pending_version_id = pending_version.get("id")
        related_logs = [log for log in change_logs if isinstance(log, dict) and log.get("carePlanVersionId") == pending_version_id]
        requested_fields = [{
            "path": f"care_plan.{index}",
            "label": f"{log.get('changeType') or 'Updated'}: {log.get('carePlanItem') or 'Care plan activity'} — {log.get('fieldChanged') or 'activity'}",
            "old_value": log.get("oldValue") or "Not captured",
            "new_value": log.get("newValue") or "Not captured",
        } for index, log in enumerate(related_logs)]
        if not requested_fields:
            return Response({"detail": "No care plan changes were detected."}, status=status.HTTP_400_BAD_REQUEST)
        intake.care_plan_versions_draft = versions
        intake.care_plan_change_logs_draft = change_logs
        intake.save(update_fields=["care_plan_versions_draft", "care_plan_change_logs_draft"])
        update_request = UpdateRequest.objects.create(
            intake=intake,
            tab="Care Plan",
            requested_fields=requested_fields,
            reason=str(request.data.get("reason") or pending_version.get("reasonForChange") or "").strip(),
            requested_by=request.user,
        )
        notify_care_plan_change_requested(intake, request.user)
        audit(request.user, "Care plan change requested", intake, {"version_id": pending_version_id or "", "update_request_id": update_request.id})
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
        stage = request.data.get("stage", "care_plan")
        if stage not in {"assessment", "care_plan"}:
            return Response({"detail": "Unknown review stage."}, status=status.HTTP_400_BAD_REQUEST)
        if decision not in {"approve", "request_revision", "approve_with_comments"}:
            return Response({"detail": "Unknown assessment and care plan decision."}, status=status.HTTP_400_BAD_REQUEST)
        if stage == "assessment":
            if intake.assessment_care_plan_status != "Submitted":
                return Response({"detail": "The assessment is not awaiting review."}, status=status.HTTP_400_BAD_REQUEST)
            intake.assessment_care_plan_status = "Assessment Revision Requested" if decision == "request_revision" else "Assessment Approved"
        else:
            if intake.assessment_care_plan_status != "Assessment Approved":
                return Response({"detail": "Approve the assessment before reviewing the care plan."}, status=status.HTTP_400_BAD_REQUEST)
            intake.assessment_care_plan_status = {
                "approve": "Approved",
                "approve_with_comments": "Approved with Comments",
                "request_revision": "Care Plan Revision Requested",
            }[decision]
        intake.assessment_care_plan_review_notes = request.data.get("notes", "")
        intake.assessment_care_plan_reviewed_at = timezone.now()
        intake.assessment_care_plan_reviewed_by = request.user
        intake.assessment_care_plan_review_history = [
            *(intake.assessment_care_plan_review_history or []),
            {
                "stage": stage,
                "decision": decision,
                "status": intake.assessment_care_plan_status,
                "notes": intake.assessment_care_plan_review_notes,
                "reviewedBy": request.user.get_full_name() or request.user.username,
                "reviewedAt": intake.assessment_care_plan_reviewed_at.isoformat(),
            },
        ]
        pending_versions = [version for version in intake.care_plan_versions_draft if isinstance(version, dict) and version.get("status") in {"Pending DSDO Approval", "Pending District Head Approval"}]
        if stage == "care_plan" and pending_versions:
            pending_version = pending_versions[-1]
            if decision in {"approve", "approve_with_comments"}:
                revised_versions = []
                for version in intake.care_plan_versions_draft:
                    if not isinstance(version, dict):
                        continue
                    next_version = dict(version)
                    if next_version.get("id") == pending_version.get("id"):
                        next_version["status"] = "Approved"
                        next_version["isActive"] = True
                    elif next_version.get("isActive"):
                        next_version["isActive"] = False
                    revised_versions.append(next_version)
                intake.care_plan_versions_draft = revised_versions
                intake.care_plan_draft = clean_care_plan_draft({"items": pending_version.get("items") or [], "child_story": pending_version.get("childStory") or ""})
            else:
                intake.care_plan_versions_draft = [
                    {**version, "status": "Revision Requested", "isActive": False} if isinstance(version, dict) and version.get("id") == pending_version.get("id") else version
                    for version in intake.care_plan_versions_draft
                ]
        intake.save()
        audit(request.user, f"Assessment and care plan review: {decision}", intake, {"notes": intake.assessment_care_plan_review_notes})
        if intake.assessment_care_plan_status not in {"Assessment Approved"}:
            resolve_notifications("case", intake.id, "assessment-care-plan-submitted")
        if decision == "request_revision" or (stage == "care_plan" and decision in {"approve", "approve_with_comments"}):
            notify_assessment_care_plan_reviewed(intake, stage=stage, decision=decision)
        return Response(IntakeSerializer(intake, context={"request": request}).data)

    @action(detail=True, methods=["post"], url_path="request-resolution")
    def request_resolution(self, request, pk=None):
        intake = self.get_object()
        if request.user != intake.allocated_officer and not has_role(request.user, SUPERVISOR_ROLES):
            return Response({"detail": "Only the allocated officer or supervisor can request resolution."}, status=status.HTTP_403_FORBIDDEN)
        intake.resolution_status = "Requested"
        resolution_payload = clean_resolution_payload(request.data.get("resolution"))
        resolution_history = request.data.get("resolution_history")
        intake.resolution_draft = resolution_payload
        if isinstance(resolution_history, list):
            intake.resolution_history_draft = resolution_history
        intake.resolution_review_notes = request.data.get("notes", "") or resolution_payload.get("currentSituation", "") or resolution_payload.get("resolutionSummary", "")
        intake.resolution_requested_at = timezone.now()
        intake.resolution_requested_by = request.user
        intake.save()
        audit(request.user, "Resolution requested", intake, {"notes": intake.resolution_review_notes})
        district = intake.alert.district if intake.alert_id else getattr(intake.created_by.profile, "district", None)
        notify_users(
            notification_recipients([UserProfile.Role.DISTRICT_HEAD], district=district, exclude_user=request.user),
            title="Resolution request submitted",
            message=f"{intake_case_reference(intake)} has a resolution request waiting for supervisor review.",
            category="Care Plan",
            priority="warning",
            target_type="case",
            target_id=intake.id,
            action_label="Review resolution",
            route="allocated-cases",
            dedupe_key=f"intake:{intake.id}:resolution-requested",
        )
        return Response(IntakeSerializer(intake, context={"request": request}).data)

    @action(detail=True, methods=["post"], url_path="review-resolution")
    def review_resolution(self, request, pk=None):
        intake = self.get_object()
        if not has_role(request.user, SUPERVISOR_ROLES):
            return Response({"detail": "Only supervisors can review resolution requests."}, status=status.HTTP_403_FORBIDDEN)
        decision = request.data.get("decision")
        if decision not in {"approve", "return", "reject"}:
            return Response({"detail": "Unknown resolution decision."}, status=status.HTTP_400_BAD_REQUEST)
        intake.resolution_status = {"approve": "Resolved", "return": "Returned", "reject": "Rejected"}[decision]
        if intake.resolution_history_draft:
            latest = dict(intake.resolution_history_draft[-1])
            latest["decision"] = {"approve": "Resolved", "return": "Return Case", "reject": "Rejected"}[decision]
            latest["status"] = intake.resolution_status
            latest["approvedBy"] = request.user.get_full_name() or request.user.username
            latest["approvedAt"] = timezone.now().isoformat()
            latest["supervisorReason"] = request.data.get("notes", "")
            intake.resolution_history_draft = [*intake.resolution_history_draft[:-1], latest]
        intake.resolution_review_notes = request.data.get("notes", "")
        intake.resolution_reviewed_at = timezone.now()
        intake.resolution_reviewed_by = request.user
        if decision == "approve":
            intake.status = Intake.Status.RESOLVED
        intake.save()
        audit(request.user, f"Resolution {decision}", intake, {"notes": intake.resolution_review_notes})
        resolve_notifications("case", intake.id, "resolution-requested")
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
    if update_request.tab == "Care Plan":
        pending_versions = [version for version in intake.care_plan_versions_draft or [] if isinstance(version, dict) and version.get("status") in {"Pending DSDO Approval", "Pending District Head Approval"}]
        if not pending_versions:
            raise ValidationError({"detail": "The pending care plan version could not be found."})
        pending = pending_versions[-1]
        revised_versions = []
        for version in intake.care_plan_versions_draft or []:
            if not isinstance(version, dict):
                continue
            next_version = dict(version)
            if next_version.get("id") == pending.get("id"):
                next_version.update({"status": "Approved", "isActive": True, "approvedAt": timezone.now().isoformat()})
            elif next_version.get("isActive"):
                next_version["isActive"] = False
            revised_versions.append(next_version)
        intake.care_plan_versions_draft = revised_versions
        intake.care_plan_draft = clean_care_plan_draft({"items": pending.get("items") or [], "child_story": pending.get("childStory") or ""})
        care_items = intake.care_plan_draft.get("items") or []
        existing_tracking = intake.service_tracking_draft or []
        intake.service_tracking_draft = clean_service_tracking([
            existing_tracking[index] if index < len(existing_tracking) and isinstance(existing_tracking[index], dict) else {}
            for index in range(len(care_items))
        ], intake.care_plan_draft)
        intake.assessment_care_plan_status = "Approved"
        intake.save(update_fields=["care_plan_versions_draft", "care_plan_draft", "service_tracking_draft", "assessment_care_plan_status", "updated_at"])
        return update_request.requested_fields
    changed = []
    direct_fields = {"case_category", "risk_level", "referral_date", "case_referred_by", "alleged_perpetrators"}
    for field in update_request.requested_fields:
        path = field.get("path")
        proposed = field.get("proposed_value", field.get("new_value"))
        if not path or proposed in (None, ""):
            continue
        root = path.split(".")[0]
        if root in direct_fields and "." not in path:
            current_value = getattr(intake, root)
            if root == "alleged_perpetrators" and isinstance(proposed, str):
                try:
                    proposed = json.loads(proposed)
                except json.JSONDecodeError:
                    proposed = []
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
    queryset = UpdateRequest.objects.select_related(
        "intake", "requested_by", "requested_by__profile", "reviewed_by", "reviewed_by__profile"
    ).all()

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
        intake = serializer.validated_data["intake"]
        if not intake.allocated_officer_id or intake.allocated_officer_id != self.request.user.id:
            raise PermissionDenied("Only the officer allocated to this case can request an update.")
        update_request = serializer.save(requested_by=self.request.user)
        audit(self.request.user, "Intake update requested", update_request.intake, {
            "update_request_id": update_request.id,
            "case_reference": intake_case_reference(update_request.intake),
            "tab": update_request.tab,
            "requested_fields": update_request.requested_fields,
            "requested_change_count": len(update_request.requested_fields or []),
            "reason": update_request.reason,
            "requested_by_id": update_request.requested_by_id,
            "requested_by": user_name(update_request.requested_by),
            "requested_by_username": update_request.requested_by.username,
            "requested_at": update_request.requested_at.isoformat(),
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
            if update_request.tab == "Care Plan":
                intake = update_request.intake
                intake.care_plan_versions_draft = [
                    {**version, "status": "Rejected", "isActive": False} if isinstance(version, dict) and version.get("status") in {"Pending DSDO Approval", "Pending District Head Approval"} else version
                    for version in intake.care_plan_versions_draft or []
                ]
                intake.save(update_fields=["care_plan_versions_draft", "updated_at"])
        else:
            return Response({"detail": "Unknown review decision."}, status=status.HTTP_400_BAD_REQUEST)
        update_request.save()
        audit(request.user, action, update_request.intake, {
            "update_request_id": update_request.id,
            "case_reference": intake_case_reference(update_request.intake),
            "tab": update_request.tab,
            "decision": update_request.status,
            "requested_fields": update_request.requested_fields,
            "reason": update_request.reason,
            "requested_by_id": update_request.requested_by_id,
            "requested_by": user_name(update_request.requested_by),
            "requested_by_username": update_request.requested_by.username,
            "requested_at": update_request.requested_at.isoformat(),
            "reviewed_by_id": update_request.reviewed_by_id,
            "reviewed_by": user_name(update_request.reviewed_by),
            "reviewed_by_username": update_request.reviewed_by.username,
            "reviewed_at": update_request.reviewed_at.isoformat(),
            "changed": changed,
            "review_notes": update_request.review_notes,
        })
        resolve_notifications("case", update_request.intake_id, f"update-request:{update_request.id}")
        create_notification(
            update_request.requested_by,
            title=f"Care plan change {update_request.status.lower()}" if update_request.tab == "Care Plan" else f"Update request {update_request.status.lower()}",
            message=f"{intake_case_reference(update_request.intake)} {update_request.tab} change request was {update_request.status.lower()}." + (f" DSDO comments: {update_request.review_notes}" if update_request.review_notes else ""),
            category="Care Plan" if update_request.tab == "Care Plan" else "Intake",
            priority="info" if update_request.status == UpdateRequest.Status.APPROVED else "warning",
            target_type="case",
            target_id=update_request.intake_id,
            action_label="Open case",
            route="allocated-cases",
            dedupe_key=f"update-request:{update_request.id}:reviewed",
        )
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
        if has_role(user, {UserProfile.Role.DISTRICT_HEAD}):
            if not user.profile.district_id:
                return self.queryset.filter(district__isnull=True, created_by=user)
            # The null fallback preserves access to existing tasks created
            # before CalendarTask gained its district field.
            return self.queryset.filter(
                Q(district=user.profile.district) |
                Q(district__isnull=True, created_by__profile__district=user.profile.district)
            )
        if has_role(user, {UserProfile.Role.DSDO}):
            # Operational officers must only receive reminders for cases that
            # are currently allocated to them, never every case in the district.
            allocated_references = Intake.objects.filter(
                allocated_officer=user,
            ).values_list("temporary_case_reference", flat=True)
            return self.queryset.filter(source__in=allocated_references)
        return self.queryset.filter(created_by=user)

    def perform_create(self, serializer):
        user = self.request.user
        if has_role(user, {UserProfile.Role.DSDO}):
            source = str(self.request.data.get("source") or "").strip()
            if not Intake.objects.filter(temporary_case_reference=source, allocated_officer=user).exists():
                raise PermissionDenied("Calendar tasks can only be created for cases allocated to you.")
        serializer.save()
