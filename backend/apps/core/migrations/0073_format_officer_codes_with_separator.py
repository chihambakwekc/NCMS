from django.db import migrations


def format_officer_codes(apps, schema_editor):
    UserProfile = apps.get_model("core", "UserProfile")
    for profile in UserProfile.objects.all().only("id", "user_id", "officer_code").iterator():
        expected_code = f"DSD-{profile.user_id:04d}"
        if profile.officer_code != expected_code:
            profile.officer_code = expected_code
            profile.save(update_fields=["officer_code"])


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0072_normalize_officer_code_prefix"),
    ]

    operations = [
        migrations.RunPython(format_officer_codes, migrations.RunPython.noop),
    ]
