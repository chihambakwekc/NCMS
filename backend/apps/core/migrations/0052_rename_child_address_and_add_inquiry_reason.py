from django.db import migrations


def rename_child_address(apps, schema_editor):
    Intake = apps.get_model("core", "Intake")
    for intake in Intake.objects.all().iterator():
        child_profile = dict(intake.child_profile_draft or {})
        if "address" not in child_profile:
            continue
        if not child_profile.get("address_of_child"):
            child_profile["address_of_child"] = child_profile["address"]
        child_profile.pop("address")
        intake.child_profile_draft = child_profile
        intake.save(update_fields=["child_profile_draft"])


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0051_remove_intake_confidentiality_and_reporter_type"),
    ]

    operations = [
        migrations.RunPython(rename_child_address, migrations.RunPython.noop),
    ]
