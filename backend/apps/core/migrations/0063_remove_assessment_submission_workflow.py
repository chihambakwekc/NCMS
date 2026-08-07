from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [("core", "0062_remove_assessment_information_statuses")]

    # The marker is restored by the following migration. Keeping this removal
    # preserves a valid migration path for both existing and fresh databases.
    operations = [
        migrations.RemoveField(model_name="intake", name="assessment_completed_at"),
        migrations.RemoveField(model_name="intake", name="assessment_completed_by"),
    ]
