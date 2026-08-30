from datetime import datetime, time

from django.db import migrations
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime


def event_datetime(value, fallback):
    parsed = parse_datetime(str(value or ""))
    if parsed:
        return parsed if timezone.is_aware(parsed) else timezone.make_aware(parsed)
    parsed_date = parse_date(str(value or ""))
    if parsed_date:
        return timezone.make_aware(datetime.combine(parsed_date, time.min))
    return fallback


def backfill_events(apps, schema_editor):
    Intake = apps.get_model("core", "Intake")
    for intake in Intake.objects.iterator():
        rows = [row for row in (intake.service_tracking_draft or []) if isinstance(row, dict)]
        started_rows = [row for row in rows if row.get("implementationNotes") or row.get("status") in {"Referred", "In Progress", "Completed"}]
        completed = bool(rows) and any(row.get("status") == "Completed" for row in rows) and all(row.get("status") in {"Completed", "Cancelled"} for row in rows)
        fields = []
        if started_rows and not intake.care_plan_implementation_started_at:
            intake.care_plan_implementation_started_at = min(event_datetime(row.get("implementationDate"), intake.updated_at) for row in started_rows)
            fields.append("care_plan_implementation_started_at")
        if completed and not intake.care_plan_implementation_completed_at:
            completed_rows = [row for row in rows if row.get("status") == "Completed"]
            intake.care_plan_implementation_completed_at = max(event_datetime(row.get("implementationDate"), intake.updated_at) for row in completed_rows)
            fields.append("care_plan_implementation_completed_at")
        if fields:
            intake.save(update_fields=fields)


class Migration(migrations.Migration):
    dependencies = [("core", "0087_add_care_plan_implementation_events")]
    operations = [migrations.RunPython(backfill_events, migrations.RunPython.noop)]
