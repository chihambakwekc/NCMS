from django.db import migrations


LOCATION_FIELDS = ("district", "ward", "village", "chief_name", "nearest_landmark")


def move_location_to_child_profile(apps, schema_editor):
    Intake = apps.get_model("core", "Intake")
    for intake in Intake.objects.all().iterator():
        opening = dict(intake.opening_summary or {})
        child_profile = dict(intake.child_profile_draft or {})
        changed = False
        for field in LOCATION_FIELDS:
            if field in opening:
                if not child_profile.get(field):
                    child_profile[field] = opening[field]
                opening.pop(field)
                changed = True
        if changed:
            intake.opening_summary = opening
            intake.child_profile_draft = child_profile
            intake.save(update_fields=["opening_summary", "child_profile_draft"])


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0047_reportgeneration"),
    ]

    operations = [
        migrations.RunPython(move_location_to_child_profile, migrations.RunPython.noop),
    ]
