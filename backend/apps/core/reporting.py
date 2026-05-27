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


def has_role(user, roles):
    return user.is_authenticated and hasattr(user, "profile") and user.profile.active and user.profile.role in roles


def scoped_alerts(user):
    qs = Alert.objects.select_related("district", "district__province", "ward", "reporter", "reporter__profile")
    if has_role(user, NATIONAL_ROLES):
        return qs
    if has_role(user, PROVINCIAL_ROLES):
        return qs.filter(district__province=user.profile.province) if user.profile.province_id else qs.none()
    if has_role(user, DISTRICT_CASE_ROLES):
        return qs.filter(district=user.profile.district) if user.profile.district_id else qs.none()
    if has_role(user, {UserProfile.Role.CCW, UserProfile.Role.NGO, UserProfile.Role.POLICE, UserProfile.Role.TEACHER, UserProfile.Role.NURSE}):
        return qs.filter(reporter=user)
    return qs.none()


def scoped_intakes(user):
    qs = Intake.objects.select_related("alert", "alert__district", "alert__district__province", "allocated_officer", "created_by", "created_by__profile")
    if has_role(user, NATIONAL_ROLES):
        return qs
    if has_role(user, PROVINCIAL_ROLES):
        return qs.filter(Q(alert__district__province=user.profile.province) | Q(alert__isnull=True, created_by__profile__province=user.profile.province)) if user.profile.province_id else qs.none()
    if has_role(user, DISTRICT_CASE_ROLES):
        return qs.filter(Q(alert__district=user.profile.district) | Q(alert__isnull=True, created_by__profile__district=user.profile.district)) if user.profile.district_id else qs.none()
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


def assessment_status(intake, now=None):
    now = now or timezone.now()
    if not intake.allocated_at:
        return "Not started"
    due_at = intake.allocated_at + timedelta(days=7)
    end_at = intake.assessment_completed_at or now
    remaining = int((due_at - end_at).total_seconds())
    if intake.assessment_completed_at:
        if remaining >= 0:
            return "Completed on time"
        return "Completed late"
    if remaining < 0:
        return "Overdue"
    if remaining <= 86400:
        return "Due soon"
    return "On time"


def build_report_payload(user, start=None, end=None):
    alerts = apply_date_range(scoped_alerts(user), start, end)
    intakes = apply_date_range(scoped_intakes(user), start, end)
    now = timezone.now()
    allocated = [item for item in intakes if item.allocated_at]
    allocation_delays = [seconds_between(item.screening_completed_at or item.reviewed_at, item.allocated_at) for item in allocated]
    assessment_counts = Counter(assessment_status(item, now) for item in intakes)
    overdue_assessments = assessment_counts.get("Overdue", 0)
    completed_assessments = intakes.filter(assessment_completed_at__isnull=False).count()

    return {
        "generatedAt": now.isoformat(),
        "scope": getattr(getattr(user, "profile", None), "role", "anonymous"),
        "summary": {
            "totalAlerts": alerts.count(),
            "totalIntakes": intakes.count(),
            "allocatedCases": len(allocated),
            "highRiskAlerts": alerts.filter(Q(emergency=True) | Q(intake__risk_level__in=["HIGH", "CRITICAL", "High", "Critical"])).count(),
            "overdueAssessments": overdue_assessments,
            "completedAssessments": completed_assessments,
            "averageAllocationDelaySeconds": average(allocation_delays),
            "averageAllocationDelayLabel": format_duration(average(allocation_delays)),
        },
        "charts": {
            "casesByProvince": rows_by_count(alerts, "district__province__name"),
            "casesByDistrict": rows_by_count(alerts, "district__name"),
            "caseStatus": rows_by_count(alerts, "status"),
            "riskDistribution": rows_by_count(intakes, "risk_level"),
            "concernDistribution": concern_distribution(alerts),
            "monthlyTrend": monthly_alert_trend(alerts),
            "assessmentStatus": [{"name": name, "value": value} for name, value in assessment_counts.items()],
            "funnel": [
                {"name": "Alerts", "value": alerts.count()},
                {"name": "Intakes", "value": intakes.count()},
                {"name": "Screened", "value": intakes.filter(screening_completed_at__isnull=False).count()},
                {"name": "Allocated", "value": len(allocated)},
                {"name": "Assessment Completed", "value": completed_assessments},
                {"name": "Closed", "value": intakes.filter(status__icontains="Closed").count()},
            ],
        },
        "tables": {
            "officerWorkload": [
                {
                    "officer": row["allocated_officer__username"] or "Unassigned",
                    "allocated": row["allocated"],
                    "completedAssessments": row["completed"],
                    "overdueAssessments": row["overdue"],
                }
                for row in intakes.values("allocated_officer__username").annotate(
                    allocated=Count("id"),
                    completed=Count("id", filter=Q(assessment_completed_at__isnull=False)),
                    overdue=Count("id", filter=Q(allocated_at__lt=now - timedelta(days=7), assessment_completed_at__isnull=True)),
                ).order_by("-allocated")
            ],
            "districtPerformance": [
                {
                    "district": row["alert__district__name"] or "Manual / not captured",
                    "cases": row["cases"],
                    "allocated": row["allocated"],
                    "completedAssessments": row["completed"],
                }
                for row in intakes.values("alert__district__name").annotate(
                    cases=Count("id"),
                    allocated=Count("id", filter=Q(allocated_at__isnull=False)),
                    completed=Count("id", filter=Q(assessment_completed_at__isnull=False)),
                ).order_by("-cases")
            ],
        },
    }
