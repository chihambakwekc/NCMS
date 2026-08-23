from django.db import migrations


OFFENCE_MAP = {
    "Assault": "Assault",
    "Sexual Offence": "Sexual Offence",
    "Injury/Injustice": "Injustice",
    "Injustice": "Injustice",
    "Malicious Damage to Property": "Malicious damage to property",
    "Theft": "Theft",
    "Shoplifting": "Shoplifting",
    "Smoking / Sniffing": "Smoking / sniffing",
    "Drug Trafficking": "Drug trafficking",
    "Forgery": "Forgery, fraud and theft by conversion",
    "Fraud": "Forgery, fraud and theft by conversion",
    "Theft by Conversion": "Forgery, fraud and theft by conversion",
    "Offence Against State and Public Order": "Offence against state and public order",
    "Wildlife Act": "Wildlife Act",
}


def move_juvenile_offences(apps, schema_editor):
    Intake = apps.get_model("core", "Intake")
    legacy_keys = {
        "offenceCategory", "offenceType", "policeReference", "courtReference",
        "hearingDate", "outcome", "probationStatus", "courtSupervision",
    }
    for intake in Intake.objects.iterator():
        justice = dict(intake.justice_draft or {})
        opening = dict(intake.opening_summary or {})
        screening = dict(opening.get("screening_draft") or {})
        assessment = dict(intake.assessment_draft or {})
        offences = list(screening.get("juvenile_offences") or assessment.pop("juvenileOffences", []) or [])
        legacy_offence = OFFENCE_MAP.get(str(justice.get("offenceType") or "").strip())
        if legacy_offence and legacy_offence not in offences:
            offences.append(legacy_offence)
        screening["juvenile_offences"] = offences
        screening["juvenile_other_property_offence"] = str(
            screening.get("juvenile_other_property_offence")
            or assessment.pop("juvenileOtherPropertyOffence", "")
            or ""
        )
        opening["screening_draft"] = screening
        cleaned_justice = {key: value for key, value in justice.items() if key not in legacy_keys}
        cleaned_justice["courtOrders"] = list(cleaned_justice.get("courtOrders") or [])
        intake.opening_summary = opening
        intake.assessment_draft = assessment
        intake.justice_draft = cleaned_justice
        intake.save(update_fields=["opening_summary", "assessment_draft", "justice_draft"])


class Migration(migrations.Migration):
    dependencies = [("core", "0075_remove_primary_caregiver_from_family_members")]
    operations = [migrations.RunPython(move_juvenile_offences, migrations.RunPython.noop)]
