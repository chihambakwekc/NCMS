from django.db import migrations


def rename_item_field(item):
    if not isinstance(item, dict):
        return item
    updated = dict(item)
    if "actionPlanNotes" not in updated:
        updated["actionPlanNotes"] = updated.get("expectedOutcome", updated.get("expected_outcome", ""))
    updated.pop("expectedOutcome", None)
    updated.pop("expected_outcome", None)
    return updated


def rename_care_plan_fields(apps, schema_editor):
    Intake = apps.get_model("core", "Intake")
    for intake in Intake.objects.iterator():
        care_plan = dict(intake.care_plan_draft or {})
        care_plan["items"] = [rename_item_field(item) for item in care_plan.get("items") or []]

        versions = []
        for version in intake.care_plan_versions_draft or []:
            if not isinstance(version, dict):
                versions.append(version)
                continue
            updated_version = dict(version)
            updated_version["items"] = [rename_item_field(item) for item in updated_version.get("items") or []]
            versions.append(updated_version)

        intake.care_plan_draft = care_plan
        intake.care_plan_versions_draft = versions
        intake.save(update_fields=["care_plan_draft", "care_plan_versions_draft"])


class Migration(migrations.Migration):
    dependencies = [("core", "0076_move_juvenile_offences_to_assessment")]
    operations = [migrations.RunPython(rename_care_plan_fields, migrations.RunPython.noop)]
