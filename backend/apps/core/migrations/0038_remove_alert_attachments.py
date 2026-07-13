from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0037_intake_justice_draft"),
    ]

    operations = [
        migrations.RemoveField(
            model_name="alert",
            name="attachments",
        ),
    ]
