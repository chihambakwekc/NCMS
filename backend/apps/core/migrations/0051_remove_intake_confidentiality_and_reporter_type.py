from django.db import migrations


def remove_retired_informant_fields(apps, schema_editor):
    Intake = apps.get_model("core", "Intake")
    for intake in Intake.objects.all().iterator():
        opening = dict(intake.opening_summary or {})
        informant = opening.get("informant")
        if not isinstance(informant, dict):
            continue
        informant = dict(informant)
        changed = False
        for field in ("confidentiality", "reporter_type"):
            if field in informant:
                informant.pop(field)
                changed = True
        if changed:
            opening["informant"] = informant
            intake.opening_summary = opening
            intake.save(update_fields=["opening_summary"])


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0050_update_relationship_type_options"),
    ]

    operations = [
        migrations.RunPython(remove_retired_informant_fields, migrations.RunPython.noop),
    ]
