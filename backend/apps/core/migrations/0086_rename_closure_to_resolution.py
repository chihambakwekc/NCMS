from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


def migrate_resolution_values(apps, schema_editor):
    Alert = apps.get_model("core", "Alert")
    AuditLog = apps.get_model("core", "AuditLog")
    Intake = apps.get_model("core", "Intake")
    Notification = apps.get_model("core", "Notification")
    ReportGeneration = apps.get_model("core", "ReportGeneration")

    def replace_terms(value):
        if isinstance(value, dict):
            return {
                (key.replace("closure", "resolution").replace("Closure", "Resolution")): replace_terms(item)
                for key, item in value.items()
            }
        if isinstance(value, list):
            return [replace_terms(item) for item in value]
        if isinstance(value, str):
            return value.replace("CLOSURE", "RESOLUTION").replace("Closure", "Resolution").replace("closure", "resolution").replace("Closed", "Resolved").replace("closed", "resolved")
        return value

    Alert.objects.filter(status="Closed - No Further Action").update(status="Resolved - No Further Action")
    Alert.objects.filter(internal_status="Closed - No Further Action").update(internal_status="Resolved - No Further Action")
    Alert.objects.filter(internal_status="Closed - Referred Externally").update(internal_status="Resolved - Referred Externally")

    for intake in Intake.objects.all().iterator():
        changed_fields = []
        if intake.resolution_status == "Approved":
            intake.resolution_status = "Resolved"
            intake.status = "Resolved"
            changed_fields.extend(["resolution_status", "status"])

        normalized_draft = replace_terms(intake.resolution_draft)
        if normalized_draft != intake.resolution_draft:
            intake.resolution_draft = normalized_draft
            changed_fields.append("resolution_draft")

        original_history = intake.resolution_history_draft if isinstance(intake.resolution_history_draft, list) else []
        history = replace_terms(original_history)
        normalized_history = []
        history_changed = history != original_history
        for value in history:
            if not isinstance(value, dict):
                normalized_history.append(value)
                continue
            record = dict(value)
            if record.get("status") == "Approved":
                record["status"] = "Resolved"
                history_changed = True
            if record.get("decision") == "Approved":
                record["decision"] = "Resolved"
                history_changed = True
            normalized_history.append(record)
        if history_changed:
            intake.resolution_history_draft = normalized_history
            changed_fields.append("resolution_history_draft")

        justice = intake.justice_draft if isinstance(intake.justice_draft, dict) else {}
        orders = justice.get("courtOrders") if isinstance(justice.get("courtOrders"), list) else []
        normalized_orders = []
        justice_changed = False
        for value in orders:
            if not isinstance(value, dict):
                continue
            order = dict(value)
            if order.get("status") == "Expired":
                order["status"] = "Completed"
                justice_changed = True
            normalized_orders.append(order)
        if justice_changed:
            intake.justice_draft = {"courtOrders": normalized_orders}
            changed_fields.append("justice_draft")

        if changed_fields:
            intake.save(update_fields=list(dict.fromkeys(changed_fields)))

    for log in AuditLog.objects.all().iterator():
        action = replace_terms(log.action)
        metadata = replace_terms(log.metadata)
        if action != log.action or metadata != log.metadata:
            log.action = action
            log.metadata = metadata
            log.save(update_fields=["action", "metadata"])

    for notification in Notification.objects.all().iterator():
        changed_fields = []
        for field in ("title", "message", "action_label", "route", "dedupe_key"):
            current = getattr(notification, field)
            updated = replace_terms(current)
            if updated != current:
                setattr(notification, field, updated)
                changed_fields.append(field)
        if changed_fields:
            notification.save(update_fields=changed_fields)

    for report in ReportGeneration.objects.all().iterator():
        changed_fields = []
        for field in ("report_type", "report_title", "filters", "summary"):
            current = getattr(report, field)
            updated = replace_terms(current)
            if updated != current:
                setattr(report, field, updated)
                changed_fields.append(field)
        if changed_fields:
            report.save(update_fields=changed_fields)


class Migration(migrations.Migration):
    dependencies = [("core", "0085_remove_court_order_expiry_and_add_system_case_number")]

    operations = [
        migrations.RenameField("intake", "closure_status", "resolution_status"),
        migrations.RenameField("intake", "closure_draft", "resolution_draft"),
        migrations.RenameField("intake", "closure_history_draft", "resolution_history_draft"),
        migrations.RenameField("intake", "closure_requested_at", "resolution_requested_at"),
        migrations.RenameField("intake", "closure_requested_by", "resolution_requested_by"),
        migrations.RenameField("intake", "closure_reviewed_at", "resolution_reviewed_at"),
        migrations.RenameField("intake", "closure_reviewed_by", "resolution_reviewed_by"),
        migrations.RenameField("intake", "closure_review_notes", "resolution_review_notes"),
        migrations.AlterField(
            model_name="alert",
            name="status",
            field=models.CharField(choices=[("Submitted", "Submitted"), ("Received by District Office", "Received by District Office"), ("Under Review", "Under Review"), ("More Information Requested", "More Information Requested"), ("Converted to Case", "Converted to Case"), ("Referred to Relevant Office", "Referred to Relevant Office"), ("Resolved - No Further Action", "Resolved - No Further Action"), ("Duplicate / Already Known", "Duplicate / Already Known"), ("Emergency Response Initiated", "Emergency Response Initiated"), ("Ready for Intake", "Ready for Intake"), ("Intake In Progress", "Intake In Progress"), ("Pending Supervisor Review", "Pending Supervisor Review"), ("Approved for Allocation", "Approved for Allocation"), ("Allocated to Case Officer", "Allocated to Case Officer"), ("Rejected", "Rejected")], default="Submitted", max_length=80),
        ),
        migrations.AlterField(
            model_name="intake",
            name="resolution_requested_by",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name="resolution_requests", to=settings.AUTH_USER_MODEL),
        ),
        migrations.AlterField(
            model_name="intake",
            name="resolution_reviewed_by",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name="reviewed_resolution_requests", to=settings.AUTH_USER_MODEL),
        ),
        migrations.AlterField(
            model_name="intake",
            name="status",
            field=models.CharField(choices=[("Intake In Progress", "Intake In Progress"), ("Intake Submitted", "Intake Submitted"), ("Screening Completed", "Screening Completed"), ("Categorized", "Categorized"), ("Pending Supervisor Review", "Pending Supervisor Review"), ("Approved for Allocation", "Approved for Allocation"), ("Returned for Correction", "Returned for Correction"), ("Allocated to Case Officer", "Allocated to Case Officer"), ("Resolved", "Resolved")], default="Intake In Progress", max_length=80),
        ),
        migrations.RunPython(migrate_resolution_values, migrations.RunPython.noop),
    ]
