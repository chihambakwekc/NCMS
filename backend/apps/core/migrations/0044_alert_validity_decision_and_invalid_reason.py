from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0043_remove_alert_current_location"),
    ]

    operations = [
        migrations.AddField(
            model_name="alert",
            name="validity_decision",
            field=models.CharField(blank=True, choices=[("VALID", "Valid"), ("INVALID", "Invalid")], max_length=20),
        ),
        migrations.AddField(
            model_name="alert",
            name="invalid_reason",
            field=models.TextField(blank=True),
        ),
    ]
