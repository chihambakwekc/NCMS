from django.db import migrations


OLD_LABEL = "Child in contact with the law"
NEW_LABEL = "Child in contact with the law custody"


def rename_case_type(apps, schema_editor):
    Alert = apps.get_model("core", "Alert")
    Intake = apps.get_model("core", "Intake")

    for alert in Alert.objects.filter(concern_categories__contains=[OLD_LABEL]):
        alert.concern_categories = [NEW_LABEL if value == OLD_LABEL else value for value in (alert.concern_categories or [])]
        alert.save(update_fields=["concern_categories"])

    for intake in Intake.objects.all().only("id", "case_category", "opening_summary"):
        updates = []
        if intake.case_category == OLD_LABEL:
            intake.case_category = NEW_LABEL
            updates.append("case_category")
        opening = intake.opening_summary or {}
        screening = opening.get("screening_draft") if isinstance(opening.get("screening_draft"), dict) else None
        categories = screening.get("selected_categories") if screening else None
        if isinstance(categories, list) and OLD_LABEL in categories:
            screening["selected_categories"] = [NEW_LABEL if value == OLD_LABEL else value for value in categories]
            intake.opening_summary = opening
            updates.append("opening_summary")
        if updates:
            intake.save(update_fields=updates)


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0066_split_aunt_uncle_relationship_type"),
    ]

    operations = [
        migrations.RunPython(rename_case_type, migrations.RunPython.noop),
    ]
