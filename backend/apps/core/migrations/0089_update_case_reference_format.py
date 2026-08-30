import re

from django.db import migrations


OLD_REFERENCE = re.compile(r"^([A-Z]{2,3})/(\d{4})/(\d+)$")


def replace_nested(value, old_reference, new_reference):
    if isinstance(value, dict):
        return {key: replace_nested(item, old_reference, new_reference) for key, item in value.items()}
    if isinstance(value, list):
        return [replace_nested(item, old_reference, new_reference) for item in value]
    if isinstance(value, str):
        return value.replace(old_reference, new_reference)
    return value


def update_case_references(apps, schema_editor):
    Intake = apps.get_model("core", "Intake")
    Notification = apps.get_model("core", "Notification")
    AuditLog = apps.get_model("core", "AuditLog")
    CalendarTask = apps.get_model("core", "CalendarTask")

    for intake in Intake.objects.all().iterator():
        old_reference = intake.temporary_case_reference or ""
        match = OLD_REFERENCE.fullmatch(old_reference)
        if not match:
            continue

        code, year, sequence = match.groups()
        new_reference = f"{code}/CW/{int(sequence)}/{year[-2:]}"

        # Update denormalized references before changing the unique case reference.
        for notification in Notification.objects.filter(message__contains=old_reference).iterator():
            notification.message = notification.message.replace(old_reference, new_reference)
            notification.save(update_fields=["message"])

        for audit in AuditLog.objects.filter(target_reference=old_reference).iterator():
            audit.target_reference = new_reference
            audit.metadata = replace_nested(audit.metadata, old_reference, new_reference)
            audit.save(update_fields=["target_reference", "metadata"])

        for audit in AuditLog.objects.exclude(target_reference=old_reference).iterator():
            updated_metadata = replace_nested(audit.metadata, old_reference, new_reference)
            if updated_metadata != audit.metadata:
                audit.metadata = updated_metadata
                audit.save(update_fields=["metadata"])

        for task in CalendarTask.objects.filter(source=old_reference).iterator():
            task.source = new_reference
            task.detail = task.detail.replace(old_reference, new_reference)
            task.save(update_fields=["source", "detail"])

        justice = replace_nested(intake.justice_draft, old_reference, new_reference)
        intake.temporary_case_reference = new_reference
        intake.justice_draft = justice
        intake.save(update_fields=["temporary_case_reference", "justice_draft"])


class Migration(migrations.Migration):
    dependencies = [("core", "0088_backfill_care_plan_implementation_events")]
    operations = [migrations.RunPython(update_case_references, migrations.RunPython.noop)]
