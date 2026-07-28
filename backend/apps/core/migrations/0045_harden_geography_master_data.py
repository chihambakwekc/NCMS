from django.db import migrations, models
from django.db.models.functions import Lower


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0044_alert_validity_decision_and_invalid_reason"),
    ]

    operations = [
        migrations.AddConstraint(
            model_name="province",
            constraint=models.UniqueConstraint(Lower("name"), name="core_province_name_ci_unique"),
        ),
        migrations.AddConstraint(
            model_name="district",
            constraint=models.UniqueConstraint(
                Lower("name"), "province", name="core_district_name_province_ci_unique"
            ),
        ),
        migrations.AlterModelOptions(
            name="province",
            options={"ordering": ["name"]},
        ),
        migrations.AlterModelOptions(
            name="district",
            options={"ordering": ["province__name", "name"]},
        ),
    ]
