from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("core", "0086_rename_closure_to_resolution")]

    operations = [
        migrations.AddField(
            model_name="intake",
            name="care_plan_implementation_started_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="intake",
            name="care_plan_implementation_completed_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
