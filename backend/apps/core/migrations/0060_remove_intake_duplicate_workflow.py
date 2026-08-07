from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [("core", "0059_remove_intake_manual_danger_fields")]

    operations = [
        migrations.RemoveField(model_name="intake", name="duplicate_result"),
        migrations.RemoveField(model_name="intake", name="initial_screening_notes"),
    ]
