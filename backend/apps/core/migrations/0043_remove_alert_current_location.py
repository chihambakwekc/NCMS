from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0042_drop_removed_emergency_detail_columns"),
    ]

    operations = [
        migrations.RemoveField(
            model_name="alert",
            name="current_location",
        ),
    ]
