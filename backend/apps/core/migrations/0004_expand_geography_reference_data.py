from django.db import migrations


def expand_geography(apps, schema_editor):
    # Geography reference data must be captured by users, not seeded by code.
    # This migration used to create Zimbabwe's provinces and default wards.
    # Keep the migration as a no-op so fresh databases start empty while
    # existing migration history remains valid.
    return None


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0003_userprofile_must_change_password"),
    ]

    operations = [
        migrations.RunPython(expand_geography, migrations.RunPython.noop),
    ]
