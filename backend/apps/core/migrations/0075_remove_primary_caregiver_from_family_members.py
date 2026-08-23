from django.db import migrations


def remove_primary_caregiver(apps, schema_editor):
    Intake = apps.get_model("core", "Intake")
    for intake in Intake.objects.all().only("id", "household_profile_draft").iterator():
        household = dict(intake.household_profile_draft or {})
        changed = False
        for key in ("family_members", "guardians"):
            members = household.get(key)
            if not isinstance(members, list):
                continue
            cleaned_members = []
            for member in members:
                if isinstance(member, dict) and "is_primary_caregiver" in member:
                    member = dict(member)
                    member.pop("is_primary_caregiver", None)
                    changed = True
                cleaned_members.append(member)
            household[key] = cleaned_members
        for key in ("draft_family_member", "draft_guardian"):
            member = household.get(key)
            if isinstance(member, dict) and "is_primary_caregiver" in member:
                member = dict(member)
                member.pop("is_primary_caregiver", None)
                household[key] = member
                changed = True
        if changed:
            intake.household_profile_draft = household
            intake.save(update_fields=["household_profile_draft"])


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0074_remove_caregiver_present_from_intakes"),
    ]

    operations = [
        migrations.RunPython(remove_primary_caregiver, migrations.RunPython.noop),
    ]
