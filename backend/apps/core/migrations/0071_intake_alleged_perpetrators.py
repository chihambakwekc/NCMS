from django.db import migrations, models


LEGACY_FIELDS = (
    "accused_name",
    "accused_relationship_to_child",
    "accused_sex",
    "accused_race",
    "referred_to_police",
    "police_referral_date",
    "court_appearance_scheduled",
    "court_appearance_date",
    "conviction_determined",
    "conviction_date",
    "circumstances_of_offence",
)


def migrate_legacy_accused(apps, schema_editor):
    Intake = apps.get_model("core", "Intake")
    for intake in Intake.objects.select_related("alert").iterator():
        opening = intake.opening_summary if isinstance(intake.opening_summary, dict) else {}
        screening = opening.get("screening_draft") if isinstance(opening.get("screening_draft"), dict) else {}
        alert = intake.alert
        name = str(screening.get("accused_name") or getattr(alert, "alleged_perpetrator_name", "") or "").strip()
        if not name:
            continue
        record = {"id": f"legacy-{intake.pk}", "name": name}
        for field in LEGACY_FIELDS:
            if field == "accused_name":
                continue
            value = screening.get(field)
            if not value and alert:
                alert_field = {
                    "accused_relationship_to_child": "alleged_perpetrator_relationship",
                    "accused_sex": "alleged_perpetrator_sex",
                    "accused_race": "alleged_perpetrator_race",
                }.get(field, field)
                value = getattr(alert, alert_field, "")
            record[{
                "accused_relationship_to_child": "relationship_to_child",
                "accused_sex": "sex",
                "accused_race": "race",
            }.get(field, field)] = str(value or "")
        intake.alleged_perpetrators = [record]
        intake.save(update_fields=["alleged_perpetrators"])


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0070_remove_intake_age_estimated"),
    ]

    operations = [
        migrations.AddField(
            model_name="intake",
            name="alleged_perpetrators",
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.RunPython(migrate_legacy_accused, migrations.RunPython.noop),
    ]
