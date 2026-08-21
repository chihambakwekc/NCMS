from django.db import migrations, models


SPECIFIC_RELATIONSHIPS = (
    "Mother",
    "Father",
    "Stepmother",
    "Stepfather",
    "Brother",
    "Sister",
    "Stepbrother",
    "Stepsister",
    "Grandmother",
    "Grandfather",
    "Aunt",
    "Uncle",
    "Guardian",
    "Caregiver",
    "Teacher",
    "Health worker",
    "Police officer",
    "Social worker",
    "Neighbour",
    "Community worker",
    "Child self-report",
    "Other",
    "Unknown",
)


def update_relationships_and_codes(apps, schema_editor):
    RelationshipType = apps.get_model("core", "RelationshipType")
    UserProfile = apps.get_model("core", "UserProfile")

    RelationshipType.objects.filter(name__in=("Parent", "Grandparent", "Relative")).delete()
    for name in SPECIFIC_RELATIONSHIPS:
        relationship, _ = RelationshipType.objects.get_or_create(name=name)
        if relationship.status != "Active":
            relationship.status = "Active"
            relationship.save(update_fields=["status"])

    for profile in UserProfile.objects.filter(officer_code__isnull=True).iterator():
        profile.officer_code = f"DSD{profile.user_id:04d}"
        profile.save(update_fields=["officer_code"])


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0067_rename_contact_with_law_case_type"),
    ]

    operations = [
        migrations.AddField(
            model_name="userprofile",
            name="officer_code",
            field=models.CharField(blank=True, editable=False, max_length=12, null=True, unique=True),
        ),
        migrations.RunPython(update_relationships_and_codes, migrations.RunPython.noop),
    ]
