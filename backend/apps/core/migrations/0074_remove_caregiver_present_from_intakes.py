from django.db import migrations


def remove_caregiver_present(apps, schema_editor):
    Intake = apps.get_model("core", "Intake")
    for intake in Intake.objects.all().only("id", "child_profile_draft").iterator():
        child_profile = dict(intake.child_profile_draft or {})
        if "caregiver_present" not in child_profile:
            continue
        child_profile.pop("caregiver_present", None)
        intake.child_profile_draft = child_profile
        intake.save(update_fields=["child_profile_draft"])


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0073_format_officer_codes_with_separator"),
    ]

    operations = [
        migrations.RunPython(remove_caregiver_present, migrations.RunPython.noop),
    ]
