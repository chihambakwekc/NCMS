from django.db import migrations


def remove_assessment_information_statuses(apps, schema_editor):
    Intake = apps.get_model("core", "Intake")
    narrative_fields = (
        "milestonesAssessmentNotes", "personalityTraits", "healthStatusAndNeeds", "educationalStatusAndNeeds",
        "provisionBasicCare", "food", "shelter", "medication", "disabilityIssues", "childSafetyNeeds",
        "emotionalWarmth", "motivationAndStimulation", "guidanceAndBoundaries", "relationshipsSignificantOthers",
        "historyAndCurrentSituation", "familyFunctioning", "familyRelationships", "dealingWithArguments",
        "socialResources", "communityResources",
    )
    retired_keys = {f"{field}{suffix}" for field in narrative_fields for suffix in ("Status", "UnavailableReason")}
    for intake in Intake.objects.exclude(assessment_draft={}):
        assessment = dict(intake.assessment_draft or {})
        cleaned = {
            key: value
            for key, value in assessment.items()
            if key not in retired_keys
        }
        if cleaned != assessment:
            intake.assessment_draft = cleaned
            intake.save(update_fields=["assessment_draft"])


class Migration(migrations.Migration):
    dependencies = [("core", "0061_intake_source_labels")]

    operations = [
        migrations.RunPython(remove_assessment_information_statuses, migrations.RunPython.noop),
    ]
