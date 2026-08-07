from django.db import migrations


NEW_RELATIONSHIPS = (
    "Brother",
    "Step brother",
    "Sister",
    "Step sister",
    "Step mother",
    "Step father",
)


def update_relationship_types(apps, schema_editor):
    RelationshipType = apps.get_model("core", "RelationshipType")
    RelationshipType.objects.filter(name__iexact="Sibling").delete()
    for name in NEW_RELATIONSHIPS:
        RelationshipType.objects.get_or_create(name=name, defaults={"status": "Active"})


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0049_two_letter_district_codes"),
    ]

    operations = [
        migrations.RunPython(update_relationship_types, migrations.RunPython.noop),
    ]
