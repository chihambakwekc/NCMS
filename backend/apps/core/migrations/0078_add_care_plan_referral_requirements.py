from django.db import migrations


EXTERNAL_RESPONSIBILITIES = {"Children's Court", "NGO Partner", "Health Facility", "Police", "School"}
INTERNAL_OR_FAMILY_RESPONSIBILITIES = {"Allocated Officer", "DSDO", "CCW", "Caregiver"}


def add_referral_requirement(item):
    if not isinstance(item, dict):
        return item
    updated = dict(item)
    responsible = updated.get("responsiblePerson") or updated.get("responsible_person") or "Allocated Officer"
    updated["responsiblePerson"] = responsible
    updated["otherResponsiblePerson"] = updated.get("otherResponsiblePerson") or updated.get("other_responsible_person", "")
    if responsible in EXTERNAL_RESPONSIBILITIES:
        updated["referralRequired"] = "Yes"
    elif responsible in INTERNAL_OR_FAMILY_RESPONSIBILITIES:
        updated["referralRequired"] = "No"
    else:
        updated["referralRequired"] = updated.get("referralRequired") or updated.get("referral_required", "")
    updated.pop("responsible_person", None)
    updated.pop("other_responsible_person", None)
    updated.pop("referral_required", None)
    return updated


def update_care_plans(apps, schema_editor):
    Intake = apps.get_model("core", "Intake")
    for intake in Intake.objects.iterator():
        care_plan = dict(intake.care_plan_draft or {})
        care_plan["items"] = [add_referral_requirement(item) for item in care_plan.get("items") or []]
        versions = []
        for version in intake.care_plan_versions_draft or []:
            if not isinstance(version, dict):
                versions.append(version)
                continue
            updated_version = dict(version)
            updated_version["items"] = [add_referral_requirement(item) for item in updated_version.get("items") or []]
            versions.append(updated_version)
        intake.care_plan_draft = care_plan
        intake.care_plan_versions_draft = versions
        intake.save(update_fields=["care_plan_draft", "care_plan_versions_draft"])


class Migration(migrations.Migration):
    dependencies = [("core", "0077_rename_care_plan_expected_outcome")]
    operations = [migrations.RunPython(update_care_plans, migrations.RunPython.noop)]
