from django.db import migrations


def add_niece_relationship_type(apps, schema_editor):
    RelationshipType = apps.get_model("core", "RelationshipType")
    relationship, _ = RelationshipType.objects.get_or_create(
        name="Niece",
        defaults={"status": "Active"},
    )
    if relationship.status != "Active":
        relationship.status = "Active"
        relationship.save(update_fields=["status", "updated_at"])


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0082_intake_assessment_care_plan_review_history"),
    ]

    operations = [
        migrations.RunPython(add_niece_relationship_type, migrations.RunPython.noop),
    ]
