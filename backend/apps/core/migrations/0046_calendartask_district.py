# Generated manually to preserve district ownership for existing calendar tasks.

from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0045_harden_geography_master_data"),
    ]

    operations = [
        migrations.AddField(
            model_name="calendartask",
            name="district",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name="calendar_tasks", to="core.district"),
        ),
        migrations.RunSQL(
            "UPDATE core_calendartask AS task SET district_id = profile.district_id FROM core_userprofile AS profile WHERE task.created_by_id = profile.user_id AND profile.district_id IS NOT NULL",
            migrations.RunSQL.noop,
        ),
        migrations.AlterUniqueTogether(
            name="calendartask",
            unique_together={("district", "source", "title", "date")},
        ),
    ]
