from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("core", "0081_expand_district_code_and_rename_district_roles")]

    operations = [
        migrations.AddField(
            model_name="intake",
            name="assessment_care_plan_review_history",
            field=models.JSONField(blank=True, default=list),
        ),
    ]
