from django.db import migrations


LEGACY_FIELDS = (
    ("Date", "date"),
    ("Activity Type", "activityType"),
    ("Person Contacted", "person"),
    ("Summary / Action Taken", "summary"),
    ("Next Step", "nextStep"),
    ("Follow-up Date", "followUp"),
)


def simplify_case_notes(apps, schema_editor):
    Intake = apps.get_model("core", "Intake")
    for intake in Intake.objects.exclude(case_notes_draft=[]).iterator():
        source = intake.case_notes_draft
        if isinstance(source, dict):
            source = [source]
        simplified = []
        for item in source if isinstance(source, list) else []:
            if not isinstance(item, dict):
                continue
            note = str(item.get("caseNote") or "").strip()
            if not note:
                note = "\n".join(
                    f"{label}: {str(item.get(key) or '').strip()}"
                    for label, key in LEGACY_FIELDS
                    if str(item.get(key) or "").strip()
                )
            if note:
                simplified.append({"caseNote": note})
        if intake.case_notes_draft != simplified:
            intake.case_notes_draft = simplified
            intake.save(update_fields=["case_notes_draft"])


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0083_add_niece_relationship_type"),
    ]

    operations = [
        migrations.RunPython(simplify_case_notes, migrations.RunPython.noop),
    ]
