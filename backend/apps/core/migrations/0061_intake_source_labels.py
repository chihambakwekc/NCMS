# Generated manually to align stored Intake source values with the intake workflow.

from django.db import migrations, models


def normalize_intake_sources(apps, schema_editor):
    Intake = apps.get_model("core", "Intake")
    Intake.objects.filter(intake_source__in=["ALERT", ""]).update(intake_source="ALERT_REFERRAL")
    Intake.objects.filter(intake_source__in=["WALK_IN", "MANUAL"]).update(intake_source="DIRECT_INTAKE")
    for intake in Intake.objects.filter(alert__isnull=True):
        opening = dict(intake.opening_summary or {})
        for key in ("alert_id", "alert_received_at", "alert_referred_at"):
            opening.pop(key, None)
        opening["source"] = "Direct Intake"
        intake.intake_source = "DIRECT_INTAKE"
        intake.opening_summary = opening
        intake.save(update_fields=["intake_source", "opening_summary"])


class Migration(migrations.Migration):
    dependencies = [("core", "0060_remove_intake_duplicate_workflow")]

    operations = [
        migrations.AlterField(
            model_name="intake",
            name="intake_source",
            field=models.CharField(blank=True, default="ALERT_REFERRAL", max_length=80),
        ),
        migrations.RunPython(normalize_intake_sources, migrations.RunPython.noop),
    ]
