from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("core", "0063_remove_assessment_submission_workflow")]

    operations = [
        migrations.AddField(
            model_name="intake",
            name="assessment_completed_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
