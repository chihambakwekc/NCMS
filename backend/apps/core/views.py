import json
from copy import deepcopy
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.db.models import Q
from django.http import HttpResponse
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Alert, AuditLog, CalendarTask, District, Intake, MoreInformationRequest, Organization, Province, UpdateRequest, UserProfile, Ward
from .reporting import build_report_payload
from .serializers import (
    AlertSerializer,
    AuditLogSerializer,
    CalendarTaskSerializer,
    ChangePasswordSerializer,
    DistrictSerializer,
    HealthSerializer,
    IntakeSerializer,
    LoginSerializer,
    MoreInformationRequestSerializer,
    OrganizationSerializer,
    ProvinceSerializer,
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
EXTERNAL_ROLES = {UserProfile.Role.CCW, UserProfile.Role.NGO, UserProfile.Role.POLICE, UserProfile.Role.TEACHER, UserProfile.Role.NURSE}

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
SUPERVISOR_ROLES = {UserProfile.Role.DISTRICT_HEAD} | NATIONAL_ROLES
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


class ReportsAnalyticsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        payload = build_report_payload(
            request.user,
            start=request.query_params.get("start") or None,
            end=request.query_params.get("end") or None,
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
        )
        workbook = Workbook()
        summary = workbook.active
        summary.title = "Summary"
        summary.append(["Metric", "Value"])
        for key, value in payload["summary"].items():
            summary.append([key, value])

        for sheet_name, rows in payload["tables"].items():
            sheet = workbook.create_sheet(sheet_name[:31])
            if not rows:
                sheet.append(["No data"])
                continue
            headers = list(rows[0].keys())
            sheet.append(headers)
            for row in rows:
                sheet.append([row.get(header, "") for header in headers])

        response = HttpResponse(content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        response["Content-Disposition"] = 'attachment; filename="ncms-report.xlsx"'
        workbook.save(response)
        return response


class ReportsPdfExportView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        from weasyprint import HTML

        payload = build_report_payload(
            request.user,
            start=request.query_params.get("start") or None,
            end=request.query_params.get("end") or None,
        )
        summary_rows = "".join(f"<tr><th>{key}</th><td>{value}</td></tr>" for key, value in payload["summary"].items())
        html = f"""
        <html>
          <head>
            <style>
              body {{ font-family: Arial, sans-serif; color: #263747; }}
              h1 {{ color: #008c7a; }}
              table {{ width: 100%; border-collapse: collapse; margin-top: 16px; }}
              th, td {{ border: 1px solid #d8dee8; padding: 8px; text-align: left; }}
              th {{ background: #f8fafc; }}
            </style>
          </head>
          <body>
            <h1>NCMS Reports & Analytics</h1>
            <p>Generated at {payload["generatedAt"]}</p>
            <table>{summary_rows}</table>
          </body>
        </html>
        """
        pdf = HTML(string=html).write_pdf()
        response = HttpResponse(pdf, content_type="application/pdf")
        response["Content-Disposition"] = 'attachment; filename="ncms-report.pdf"'
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


class DistrictViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = DistrictSerializer
    queryset = District.objects.select_related("province").all().order_by("name")


class ProvinceViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = ProvinceSerializer
    queryset = Province.objects.all().order_by("name")


class WardViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = WardSerializer
    queryset = Ward.objects.select_related("district").all().order_by("district__name", "name")


class OrganizationViewSet(viewsets.ModelViewSet):
    serializer_class = OrganizationSerializer
    queryset = Organization.objects.all().order_by("name")

    def create(self, request, *args, **kwargs):
        if not has_role(request.user, {UserProfile.Role.SYS_ADMIN}):
            return Response({"detail": "Only system administrators can create organizations."}, status=status.HTTP_403_FORBIDDEN)
        return super().create(request, *args, **kwargs)


class AlertViewSet(viewsets.ModelViewSet):
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

    @action(detail=True, methods=["post"])
    def triage(self, request, reference=None):
        alert = self.get_object()
        action_name = request.data.get("action")
        if not has_role(request.user, DISTRICT_CASE_ROLES | {UserProfile.Role.SYS_ADMIN}):
            return Response({"detail": "You do not have permission to triage alerts."}, status=status.HTTP_403_FORBIDDEN)
        if alert.status in FINAL_ALERT_STATUSES:
            return Response({"detail": f"Alert actions are locked because this alert is already {alert.status}."}, status=status.HTTP_400_BAD_REQUEST)

        if action_name == "accept":
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
        intake, created = Intake.objects.get_or_create(
            alert=alert,
            defaults={
                "temporary_case_reference": alert.reference.replace("ALT", "TMP-CASE"),
                "intake_source": "ALERT",
                "original_alert_snapshot": {
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
                    "current_location": alert.current_location,
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
                    "danger_screening": alert.danger_screening,
                    "incident_date": alert.incident_date.isoformat() if alert.incident_date else "",
                    "incident_location": alert.incident_location,
                    "description": alert.description,
                    "alleged_perpetrator_name": alert.alleged_perpetrator_name,
                    "alleged_perpetrator_relationship": alert.alleged_perpetrator_relationship,
                    "perpetrator_has_access": alert.perpetrator_has_access,
                    "immediate_action_taken": alert.immediate_action_taken,
                    "services_contacted": alert.services_contacted,
                    "attachments": alert.attachments,
                    "emergency": alert.emergency,
                    "status": alert.status,
                    "internal_status": alert.internal_status,
                },
                "opening_summary": {
                    "source": "Converted from alert",
                    "concern_summary": ", ".join(alert.concern_categories) if alert.concern_categories else "Uncategorized",
                    "reporter_narrative": alert.description,
                },
                "child_profile_draft": {
                    "name": alert.child_display_name,
                    "sex": alert.sex,
                    "age": alert.estimated_age,
                    "address": alert.current_location or alert.home_address,
                    "district": alert.district.name if alert.district else "",
                    "ward": alert.ward.name if alert.ward else "",
                },
                "household_profile_draft": {
                    "caregiver_name": alert.caregiver_name,
                    "caregiver_contact": alert.caregiver_contact,
                    "home_address": alert.home_address,
                },
                "case_category": ", ".join(alert.concern_categories[:1]) or "Uncategorized",
                "risk_level": "High" if alert.emergency else "Medium",
                "immediate_action_required": alert.emergency,
                "created_by": request.user,
            },
        )
        alert.status = Alert.Status.CONVERTED
        alert.internal_status = "Intake In Progress"
        if not alert.assigned_intake_officer and has_role(request.user, {UserProfile.Role.DSDO}):
            alert.assigned_intake_officer = request.user
        alert.save()
        audit(request.user, "Alert converted to intake" if created else "Existing intake opened", alert)
        return Response(IntakeSerializer(intake, context={"request": request}).data, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)


class IntakeViewSet(viewsets.ModelViewSet):
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

    def perform_create(self, serializer):
        source = self.request.data.get("intake_source") or "WALK_IN"
        reference_prefix = "TMP" if source != "ALERT" else "TMP-CASE"
        reference = f"{reference_prefix}-{timezone.now().year}-{Intake.objects.count() + 1:03d}"
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
        if not intake.screening_completed_at:
            intake.screening_completed_at = timezone.now()
        intake.status = Intake.Status.SUPERVISOR_REVIEW
        intake.save()
        if intake.alert:
            intake.alert.status = Alert.Status.SUPERVISOR_REVIEW
            intake.alert.internal_status = "Pending Supervisor Review"
            intake.alert.save()
        audit(request.user, "Initial screening submitted", intake)
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
        referrals = request.data.get("referrals") or []
        service_tracking = request.data.get("service_tracking") or []
        case_notes = request.data.get("case_notes") or []
        case_documents = request.data.get("case_documents") or []
        if not assessment:
            return Response({"detail": "Assessment is required before the care plan can be submitted."}, status=status.HTTP_400_BAD_REQUEST)
        if not care_plan.get("items"):
            return Response({"detail": "Care plan is required for combined submission."}, status=status.HTTP_400_BAD_REQUEST)
        now = timezone.now()
        intake.assessment_draft = assessment
        intake.care_plan_draft = care_plan
        intake.referrals_draft = referrals
        intake.service_tracking_draft = service_tracking
        intake.case_notes_draft = case_notes
        intake.case_documents_draft = case_documents
        intake.assessment_completed_at = intake.assessment_completed_at or now
        intake.assessment_completed_by = intake.assessment_completed_by or request.user
        intake.assessment_care_plan_status = "Submitted"
        intake.assessment_care_plan_submitted_at = now
        intake.assessment_care_plan_submitted_by = request.user
        intake.save()
        audit(request.user, "Assessment and care plan submitted", intake)
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
        intake.referrals_draft = request.data.get("referrals", intake.referrals_draft or [])
        intake.service_tracking_draft = request.data.get("service_tracking", intake.service_tracking_draft or [])
        intake.case_notes_draft = request.data.get("case_notes", intake.case_notes_draft or [])
        intake.case_documents_draft = request.data.get("case_documents", intake.case_documents_draft or [])
        if intake.assessment_care_plan_status in {"", "Submitted"}:
            intake.assessment_care_plan_status = "Draft"
        intake.save()
        audit(request.user, "Case execution draft saved", intake)
        return Response(IntakeSerializer(intake, context={"request": request}).data)

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
        return Response(IntakeSerializer(intake, context={"request": request}).data)

    @action(detail=True, methods=["post"], url_path="supervisor-case-review")
    def supervisor_case_review(self, request, pk=None):
        intake = self.get_object()
        if not has_role(request.user, SUPERVISOR_ROLES):
            return Response({"detail": "Only supervisors can record case reviews."}, status=status.HTTP_403_FORBIDDEN)
        decision = request.data.get("decision", "Continue Current Plan")
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
        intake.closure_review_notes = request.data.get("notes", "")
        intake.closure_requested_at = timezone.now()
        intake.closure_requested_by = request.user
        intake.save()
        audit(request.user, "Closure requested", intake, {"notes": intake.closure_review_notes})
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
        intake.closure_review_notes = request.data.get("notes", "")
        intake.closure_reviewed_at = timezone.now()
        intake.closure_reviewed_by = request.user
        intake.save()
        audit(request.user, f"Closure {decision}", intake, {"notes": intake.closure_review_notes})
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
    for field in update_request.requested_fields:
        path = field.get("path")
        proposed = field.get("proposed_value")
        if not path or proposed in (None, ""):
            continue
        root = path.split(".")[0]
        if root not in {"opening_summary", "child_profile_draft", "household_profile_draft", "background_information"}:
            continue
        current = deepcopy(getattr(intake, root) or {})
        set_json_path(current, ".".join(path.split(".")[1:]), proposed)
        setattr(intake, root, current)
        changed.append({"path": path, "label": field.get("label"), "from": field.get("current_value", ""), "to": proposed})
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


class AuditLogViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = AuditLogSerializer
    queryset = AuditLog.objects.select_related("actor").all()

    def get_queryset(self):
        if has_role(self.request.user, INTERNAL_ROLES):
            return self.queryset
        return AuditLog.objects.none()


class CalendarTaskViewSet(viewsets.ModelViewSet):
    serializer_class = CalendarTaskSerializer
    queryset = CalendarTask.objects.select_related("created_by").all()

    def get_queryset(self):
        user = self.request.user
        if has_role(user, INTERNAL_ROLES):
            return self.queryset
        return self.queryset.filter(created_by=user)
