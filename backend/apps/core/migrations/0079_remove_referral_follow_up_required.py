from django.db import migrations


def remove_follow_up_required(apps, schema_editor):
    Intake = apps.get_model("core", "Intake")
    for intake in Intake.objects.iterator():
        referrals = intake.referrals_draft
        if not isinstance(referrals, list):
            continue
        changed = False
        cleaned = []
        for item in referrals:
            if not isinstance(item, dict):
                cleaned.append(item)
                continue
            referral = dict(item)
            if "followUpRequired" in referral or "follow_up_required" in referral:
                changed = True
            referral.pop("followUpRequired", None)
            referral.pop("follow_up_required", None)
            cleaned.append(referral)
        if changed:
            intake.referrals_draft = cleaned
            intake.save(update_fields=["referrals_draft"])


class Migration(migrations.Migration):
    dependencies = [("core", "0078_add_care_plan_referral_requirements")]
    operations = [migrations.RunPython(remove_follow_up_required, migrations.RunPython.noop)]
