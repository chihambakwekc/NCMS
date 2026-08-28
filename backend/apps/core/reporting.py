from collections import Counter
from datetime import timedelta

from django.db.models import Count, Q
from django.db.models.functions import TruncMonth
from django.utils import timezone

from .models import Alert, Intake, UserProfile

NATIONAL_ROLES = {
    UserProfile.Role.SYS_ADMIN,
    UserProfile.Role.DEPUTY_DIRECTOR,
    UserProfile.Role.DIRECTOR,
    UserProfile.Role.PROGRAMME_OFFICER,
}
PROVINCIAL_ROLES = {UserProfile.Role.PROVINCIAL_HEAD}
DISTRICT_CASE_ROLES = {UserProfile.Role.DISTRICT_HEAD, UserProfile.Role.DSDO}

REPORT_TYPES = {
    "case-statistics": ("Case Statistics Report", ["totalAlerts", "totalIntakes", "allocatedCases"]),
    "risk-trends": ("Risk & Abuse Trends Report", ["totalAlerts", "highRiskAlerts", "totalIntakes"]),
    "intake-screening": ("Intake & Screening Report", ["totalIntakes", "allocatedCases", "averageAllocationDelayLabel"]),
    "assessment": ("Assessment Report", ["totalIntakes", "allocatedCases"]),
    "referrals-services": ("Referrals & Services Report", ["totalIntakes", "allocatedCases"]),
    "review-resolution": ("Case Review & Resolution Report", ["totalIntakes", "resolvedCases", "allocatedCases"]),
    "ccw-summary": ("CCW Monthly Case Summary", ["totalAlerts", "totalIntakes", "highRiskAlerts"]),
    "geographic": ("Geographic Report", ["totalAlerts", "totalIntakes", "allocatedCases"]),
}


def has_role(user, roles):
    return user.is_authenticated and hasattr(user, "profile") and user.profile.active and user.profile.role in roles


def scoped_alerts(user):
    qs = Alert.objects.select_related("district", "district__province", "ward", "reporter", "reporter__profile")
    if has_role(user, NATIONAL_ROLES):
        return qs
    if has_role(user, PROVINCIAL_ROLES):
        return qs.filter(district__province=user.profile.province) if user.profile.province_id else qs.none()
    if has_role(user, {UserProfile.Role.DISTRICT_HEAD}):
        return qs.filter(district=user.profile.district) if user.profile.district_id else qs.none()
    if has_role(user, {UserProfile.Role.DSDO}):
        return qs.filter(
            Q(assigned_intake_officer=user) |
            Q(intake__allocated_officer=user) |
            Q(reporter=user)
        ).distinct()
    if has_role(user, {UserProfile.Role.CCW}):
        return qs.filter(reporter=user)
    return qs.none()


def scoped_intakes(user):
    qs = Intake.objects.select_related("alert", "alert__district", "alert__district__province", "allocated_officer", "created_by", "created_by__profile")
    if has_role(user, NATIONAL_ROLES):
        return qs
    if has_role(user, PROVINCIAL_ROLES):
        return qs.filter(Q(alert__district__province=user.profile.province) | Q(alert__isnull=True, created_by__profile__province=user.profile.province)) if user.profile.province_id else qs.none()
    if has_role(user, {UserProfile.Role.DISTRICT_HEAD}):
        return qs.filter(Q(alert__district=user.profile.district) | Q(alert__isnull=True, created_by__profile__district=user.profile.district)) if user.profile.district_id else qs.none()
    if has_role(user, {UserProfile.Role.DSDO}):
        return qs.filter(Q(allocated_officer=user) | Q(created_by=user)).distinct()
    return qs.filter(allocated_officer=user)


def apply_date_range(qs, start=None, end=None, field="created_at"):
    if start:
        qs = qs.filter(**{f"{field}__date__gte": start})
    if end:
        qs = qs.filter(**{f"{field}__date__lte": end})
    return qs


def rows_by_count(qs, field, label="name"):
    rows = qs.values(field).annotate(value=Count("id")).order_by("-value")
    return [{"name": row[field] or "Not captured", "value": row["value"]} for row in rows]


def monthly_alert_trend(alerts):
    rows = alerts.annotate(month=TruncMonth("created_at")).values("month").annotate(value=Count("id")).order_by("month")
    return [{"month": row["month"].strftime("%Y-%m") if row["month"] else "Unknown", "value": row["value"]} for row in rows]


def concern_distribution(alerts):
    counts = Counter()
    for categories in alerts.values_list("concern_categories", flat=True):
        if categories:
            counts.update(categories)
        else:
            counts["Uncategorized"] += 1
    return [{"name": name, "value": value} for name, value in counts.most_common()]


def seconds_between(start, end):
    if not start or not end:
        return None
    return max(0, int((end - start).total_seconds()))


def average(values):
    clean = [value for value in values if value is not None]
    return round(sum(clean) / len(clean)) if clean else None


def format_duration(seconds):
    if seconds is None:
        return "-"
    days = seconds // 86400
    hours = (seconds % 86400) // 3600
    minutes = (seconds % 3600) // 60
    parts = []
    if days:
        parts.append(f"{days}d")
    if hours:
        parts.append(f"{hours}h")
    if not days and minutes:
        parts.append(f"{minutes}m")
    return " ".join(parts) or "0m"


def apply_report_filters(alerts, intakes, province=None, district=None, status=None, risk=None, category=None):
    """Apply optional report filters without widening the user's authorised scope."""
    if province:
        alerts = alerts.filter(district__province__name__iexact=province)
        intakes = intakes.filter(
            Q(alert__district__province__name__iexact=province)
            | Q(alert__isnull=True, created_by__profile__province__name__iexact=province)
        )
    if district:
        alerts = alerts.filter(district__name__iexact=district)
        intakes = intakes.filter(
            Q(alert__district__name__iexact=district)
            | Q(alert__isnull=True, created_by__profile__district__name__iexact=district)
        )
    if status:
        frontend_statuses = {
            "Draft": [
                Intake.Status.DRAFT,
                Intake.Status.SCREENED,
                Intake.Status.CATEGORIZED,
                Intake.Status.RETURNED,
            ],
            "Submitted": [Intake.Status.SUBMITTED],
            "Pending Supervisor Review": [Intake.Status.SUPERVISOR_REVIEW],
            "Approved for Allocation": [Intake.Status.APPROVED],
            "Allocated": [Intake.Status.ALLOCATED],
        }
        selected_statuses = frontend_statuses.get(status, [status])
        intakes = intakes.filter(status__in=selected_statuses)
        alerts = alerts.filter(intake__status__in=selected_statuses)
    if risk:
        intakes = intakes.filter(risk_level__iexact=risk)
        alerts = alerts.filter(intake__risk_level__iexact=risk)
    if category:
        if category == "Uncategorized":
            intakes = intakes.filter(case_category="")
            alerts = alerts.filter(Q(intake__case_category="") | Q(intake__isnull=True))
        else:
            intakes = intakes.filter(case_category__iexact=category)
            alerts = alerts.filter(intake__case_category__iexact=category)
    return alerts, intakes


def build_report_payload(
    user,
    start=None,
    end=None,
    report_type=None,
    province=None,
    district=None,
    status=None,
    risk=None,
    category=None,
):
    alerts = apply_date_range(scoped_alerts(user), start, end)
    intakes = apply_date_range(scoped_intakes(user), start, end)
    alerts, intakes = apply_report_filters(
        alerts,
        intakes,
        province=province,
        district=district,
        status=status,
        risk=risk,
        category=category,
    )
    now = timezone.now()
    allocated = [item for item in intakes if item.allocated_at]
    allocation_delays = [seconds_between(item.screening_completed_at or item.reviewed_at, item.allocated_at) for item in allocated]
    completed_assessments = intakes.filter(assessment_completed_at__isnull=False).count()
    pending_assessments = intakes.filter(assessment_completed_at__isnull=True).count()
    summary = {
        "totalAlerts": alerts.count(),
        "totalIntakes": intakes.count(),
        "allocatedCases": len(allocated),
        "highRiskAlerts": alerts.filter(Q(emergency=True) | Q(intake__risk_level__in=["HIGH", "CRITICAL", "High", "Critical"])).count(),
        "resolvedCases": intakes.filter(resolution_status="Resolved").count(),
        "averageAllocationDelaySeconds": average(allocation_delays),
        "averageAllocationDelayLabel": format_duration(average(allocation_delays)),
    }
    report_definition = REPORT_TYPES.get(report_type)
    if report_definition:
        report_title, keys = report_definition
        summary = {key: summary[key] for key in keys}
    else:
        report_title = "NCMS Reports & Analytics"

    return {
        "generatedAt": now.isoformat(),
        "scope": getattr(getattr(user, "profile", None), "role", "anonymous"),
        "reportTitle": report_title,
        "filters": {
            "start": start or "",
            "end": end or "",
            "province": province or "",
            "district": district or "",
            "status": status or "",
            "risk": risk or "",
            "category": category or "",
        },
        "summary": summary,
        "charts": {
            "casesByProvince": rows_by_count(alerts, "district__province__name"),
            "casesByDistrict": rows_by_count(alerts, "district__name"),
            "caseStatus": rows_by_count(alerts, "status"),
            "riskDistribution": rows_by_count(intakes, "risk_level"),
            "concernDistribution": concern_distribution(alerts),
            "monthlyTrend": monthly_alert_trend(alerts),
            "funnel": [
                {"name": "Alerts", "value": alerts.count()},
                {"name": "Intakes", "value": intakes.count()},
                {"name": "Screened", "value": intakes.filter(screening_completed_at__isnull=False).count()},
                {"name": "Allocated", "value": len(allocated)},
                {"name": "Resolved", "value": intakes.filter(resolution_status="Resolved").count()},
            ],
            "assessmentStatus": [
                {"name": "Completed", "value": completed_assessments},
                {"name": "Not completed", "value": pending_assessments},
            ],
        },
    }
