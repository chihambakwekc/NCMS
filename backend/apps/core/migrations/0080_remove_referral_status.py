from django.db import migrations


def remove_referral_status(apps, schema_editor):
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
            if "status" in referral:
                changed = True
                referral.pop("status", None)
            cleaned.append(referral)
        if changed:
            intake.referrals_draft = cleaned
            intake.save(update_fields=["referrals_draft"])


class Migration(migrations.Migration):
    dependencies = [("core", "0079_remove_referral_follow_up_required")]
    operations = [migrations.RunPython(remove_referral_status, migrations.RunPython.noop)]
