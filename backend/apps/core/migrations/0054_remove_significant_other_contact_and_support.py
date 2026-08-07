from django.db import migrations


def clean_significant_other(member):
    if not isinstance(member, dict):
        return member, False
    cleaned = dict(member)
    changed = False
    if "nature_of_support" in cleaned:
        cleaned.pop("nature_of_support")
        changed = True
    if str(cleaned.get("person_category") or "").strip() == "Significant Other" and "telephone" in cleaned:
        cleaned.pop("telephone")
        changed = True
    return cleaned, changed


def remove_significant_other_contact_and_support(apps, schema_editor):
    Intake = apps.get_model("core", "Intake")
    for intake in Intake.objects.all().iterator():
        household = dict(intake.household_profile_draft or {})
        changed = False
        for key in ("family_members", "guardians"):
            members = household.get(key)
            if not isinstance(members, list):
                continue
            cleaned_members = []
            for member in members:
                cleaned, member_changed = clean_significant_other(member)
                cleaned_members.append(cleaned)
                changed = changed or member_changed
            if changed:
                household[key] = cleaned_members
        for key in ("draft_family_member", "draft_guardian"):
            cleaned, member_changed = clean_significant_other(household.get(key))
            if member_changed:
                household[key] = cleaned
                changed = True
        if changed:
            intake.household_profile_draft = household
            intake.save(update_fields=["household_profile_draft"])


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0053_simplify_family_member_details"),
    ]

    operations = [
        migrations.RunPython(remove_significant_other_contact_and_support, migrations.RunPython.noop),
    ]
