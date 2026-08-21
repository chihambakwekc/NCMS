from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0068_specific_relationships_and_officer_code"),
    ]

    operations = [
        migrations.AddField(
            model_name="intake",
            name="referral_date",
            field=models.DateField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="intake",
            name="case_referred_by",
            field=models.CharField(blank=True, max_length=180),
        ),
    ]
