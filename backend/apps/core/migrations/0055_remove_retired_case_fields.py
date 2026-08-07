from django.db import migrations


RETIRED_SCREENING_FIELDS = ("case_category_notes", "accused_address", "police_reference_number")


def remove_retired_intake_values(apps, schema_editor):
    Intake = apps.get_model("core", "Intake")
    for intake in Intake.objects.all().iterator():
        opening = dict(intake.opening_summary or {})
        screening = opening.get("screening_draft")
        if not isinstance(screening, dict):
            continue
        cleaned = dict(screening)
        changed = False
        for field in RETIRED_SCREENING_FIELDS:
            if field in cleaned:
                cleaned.pop(field)
                changed = True
        if changed:
            opening["screening_draft"] = cleaned
            intake.opening_summary = opening
            intake.save(update_fields=["opening_summary"])


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0054_remove_significant_other_contact_and_support"),
    ]

    operations = [
        migrations.RunPython(remove_retired_intake_values, migrations.RunPython.noop),
        migrations.RemoveField(model_name="alert", name="alleged_perpetrator_address"),
        migrations.RemoveField(model_name="alert", name="police_reference_number"),
    ]
