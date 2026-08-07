from django.db import migrations


def split_aunt_uncle_relationship_type(apps, schema_editor):
    RelationshipType = apps.get_model("core", "RelationshipType")
    RelationshipType.objects.filter(name="Aunt / Uncle").delete()
    for name in ("Aunt", "Uncle"):
        RelationshipType.objects.get_or_create(name=name, defaults={"status": "Active"})


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0065_remove_immediate_family_relationship_types"),
    ]

    operations = [
        migrations.RunPython(split_aunt_uncle_relationship_type, migrations.RunPython.noop),
    ]
