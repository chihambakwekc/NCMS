from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0039_remove_seeded_geography_reference_data"),
    ]

    operations = [
        migrations.AlterField(
            model_name="userprofile",
            name="role",
            field=models.CharField(
                choices=[
                    ("SYS_ADMIN", "System Administrator"),
                    ("DEPUTY_DIRECTOR", "Deputy Director"),
                    ("DIRECTOR", "Director"),
                    ("PROGRAMME_OFFICER", "Programme Officer"),
                    ("PROVINCIAL_HEAD", "Provincial Head"),
                    ("DISTRICT_HEAD", "District Head"),
                    ("DSDO", "DSDO"),
                    ("CCW", "Community Case Worker"),
                ],
                max_length=40,
            ),
        ),
    ]
