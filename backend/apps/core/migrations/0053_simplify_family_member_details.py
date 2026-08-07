from django.db import migrations


REMOVED_FAMILY_MEMBER_FIELDS = ("relationship_to_child", "lives_with_child", "notes")
VALID_LIVING_STATUSES = {"Deceased", "Abandoned"}


def clean_member(member):
    if not isinstance(member, dict):
        return member, False
    cleaned = dict(member)
    changed = False
    for field in REMOVED_FAMILY_MEMBER_FIELDS:
        if field in cleaned:
            cleaned.pop(field)
            changed = True
    if cleaned.get("living_involvement_status") == "Abandoned child":
        cleaned["living_involvement_status"] = "Abandoned"
        changed = True
    elif cleaned.get("living_involvement_status") and cleaned.get("living_involvement_status") not in VALID_LIVING_STATUSES:
        cleaned["living_involvement_status"] = ""
        changed = True
    return cleaned, changed


def simplify_family_member_details(apps, schema_editor):
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
                cleaned, member_changed = clean_member(member)
                cleaned_members.append(cleaned)
                changed = changed or member_changed
            if changed:
                household[key] = cleaned_members
        for key in ("draft_family_member", "draft_guardian"):
            cleaned, member_changed = clean_member(household.get(key))
            if member_changed:
                household[key] = cleaned
                changed = True
        if changed:
            intake.household_profile_draft = household
            intake.save(update_fields=["household_profile_draft"])


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0052_rename_child_address_and_add_inquiry_reason"),
    ]

    operations = [
        migrations.RunPython(simplify_family_member_details, migrations.RunPython.noop),
    ]
