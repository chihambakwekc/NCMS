from django.db import migrations


def normalize_officer_codes(apps, schema_editor):
    UserProfile = apps.get_model("core", "UserProfile")
    for profile in UserProfile.objects.all().only("id", "user_id", "officer_code").iterator():
        expected_code = f"DSDO{profile.user_id:04d}"
        if profile.officer_code != expected_code:
            profile.officer_code = expected_code
            profile.save(update_fields=["officer_code"])


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0071_intake_alleged_perpetrators"),
    ]

    operations = [
        migrations.RunPython(normalize_officer_codes, migrations.RunPython.noop),
    ]
