from django.db import migrations


def remove_age_estimated(apps, schema_editor):
    Intake = apps.get_model("core", "Intake")
    for intake in Intake.objects.all().only("id", "child_profile_draft").iterator():
        child_profile = intake.child_profile_draft
        if not isinstance(child_profile, dict) or "age_is_estimated" not in child_profile:
            continue
        child_profile = dict(child_profile)
        child_profile.pop("age_is_estimated", None)
        intake.child_profile_draft = child_profile
        intake.save(update_fields=["child_profile_draft"])


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0069_intake_referral_details"),
    ]

    operations = [
        migrations.RunPython(remove_age_estimated, migrations.RunPython.noop),
    ]
