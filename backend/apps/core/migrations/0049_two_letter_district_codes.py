from django.core.validators import RegexValidator
from django.db import migrations, models


def shorten_district_codes(apps, schema_editor):
    District = apps.get_model("core", "District")
    used_codes = set()
    updates = []

    for district in District.objects.order_by("id"):
        code = "".join(character for character in (district.code or "").upper() if character.isalpha())[:2]
        if len(code) != 2:
            raise RuntimeError(f"District '{district.name}' does not have a valid two-letter code.")
        if code in used_codes:
            raise RuntimeError(
                f"Cannot shorten district code '{district.code}' for '{district.name}' to '{code}' because it duplicates another district. "
                "Assign unique two-letter district codes before applying this migration."
            )
        used_codes.add(code)
        if district.code != code:
            updates.append((district, code))

    for district, code in updates:
        district.code = code
        district.save(update_fields=["code"])


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0048_move_intake_location_to_child_profile"),
    ]

    operations = [
        migrations.RunPython(shorten_district_codes, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="district",
            name="code",
            field=models.CharField(
                max_length=2,
                unique=True,
                validators=[RegexValidator(message="District code must be exactly 2 uppercase letters.", regex="^[A-Z]{2}$")],
            ),
        ),
    ]
