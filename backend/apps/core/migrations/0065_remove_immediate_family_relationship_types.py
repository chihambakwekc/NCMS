from django.db import migrations


# These values describe a family member's type and belong in the Family Member
# form, not in the generic "Relationship to child" reference list.
REMOVED_RELATIONSHIPS = (
    "Mother",
    "Father",
    "Step mother",
    "Step father",
    "Stepmother",
    "Stepfather",
    "Brother",
    "Step brother",
    "Sister",
    "Step sister",
)


def remove_immediate_family_relationship_types(apps, schema_editor):
    RelationshipType = apps.get_model("core", "RelationshipType")
    RelationshipType.objects.filter(name__in=REMOVED_RELATIONSHIPS).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0064_restore_assessment_completion_marker"),
    ]

    operations = [
        migrations.RunPython(remove_immediate_family_relationship_types, migrations.RunPython.noop),
    ]
