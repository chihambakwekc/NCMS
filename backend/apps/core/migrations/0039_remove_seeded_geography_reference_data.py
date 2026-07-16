from django.db import migrations


SEEDED_PROVINCES = [
    "Bulawayo Province",
    "Harare Province",
    "Manicaland Province",
    "Mashonaland Central Province",
    "Mashonaland East Province",
    "Mashonaland West Province",
    "Masvingo Province",
    "Matabeleland North Province",
    "Matabeleland South Province",
    "Midlands Province",
]


def remove_unreferenced_seeded_geography(apps, schema_editor):
    Province = apps.get_model("core", "Province")

    for province in Province.objects.filter(name__in=SEEDED_PROVINCES):
        if province.districts.exists():
            continue
        province.delete()


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0038_remove_alert_attachments"),
    ]

    operations = [
        migrations.RunPython(remove_unreferenced_seeded_geography, migrations.RunPython.noop),
    ]
