from django.core.validators import RegexValidator
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("core", "0080_remove_referral_status")]

    operations = [
        migrations.AlterField(
            model_name="district",
            name="code",
            field=models.CharField(
                max_length=3,
                unique=True,
                validators=[
                    RegexValidator(
                        regex=r"^[A-Z]{2,3}$",
                        message="District code must be 2 or 3 uppercase letters.",
                    )
                ],
            ),
        ),
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
                    ("DISTRICT_HEAD", "DSDO"),
                    ("DSDO", "SDO"),
                    ("CCW", "Community Case Worker"),
                ],
                max_length=40,
            ),
        ),
    ]
