from django.contrib.auth import get_user_model
from django.test import SimpleTestCase
from rest_framework.exceptions import ValidationError
from rest_framework.test import APITestCase

from .views import (
    ASSESSMENT_NARRATIVE_FIELDS,
    ASSESSMENT_SCHEMA_VERSION,
    apply_intake_update_request,
    clean_assessment_draft,
    normalize_care_plan_item,
    notification_recipients,
    validate_assessment_submission,
)
from .models import District, Intake, Province, UpdateRequest, UserProfile


def complete_assessment_payload():
    payload = {
        "assessmentDate": "2026-07-31",
        "assessmentType": "Home Visit",
        "assessmentLocation": "Harare District",
        "childSeen": "Yes",
        "parentCarerSeen": "Yes",
        "personsInterviewed": ["Child", "Mother"],
        "milestones": ["Walking"],
    }
    payload.update({key: "Recorded assessment narrative." for key in ASSESSMENT_NARRATIVE_FIELDS})
    return payload


class ApprovedAssessmentSchemaTests(SimpleTestCase):
    def test_cleaning_removes_retired_assessment_fields(self):
        cleaned = clean_assessment_draft({
            **complete_assessment_payload(),
            "keyConcerns": ["Neglect"],
            "decision": "Proceed to Care Plan",
            "supervisorAttentionRequired": "Yes",
        })

        self.assertEqual(cleaned["schemaVersion"], ASSESSMENT_SCHEMA_VERSION)
        self.assertNotIn("keyConcerns", cleaned)
        self.assertNotIn("decision", cleaned)
        self.assertNotIn("supervisorAttentionRequired", cleaned)

    def test_child_interview_sets_child_seen(self):
        payload = complete_assessment_payload()
        payload["childSeen"] = ""

        cleaned = clean_assessment_draft(payload)

        self.assertEqual(cleaned["childSeen"], "Yes")

    def test_contradictory_child_interview_is_rejected(self):
        payload = complete_assessment_payload()
        payload["childSeen"] = "No"

        with self.assertRaises(ValidationError):
            clean_assessment_draft(payload)

    def test_contradictory_parent_carer_interview_is_rejected(self):
        payload = complete_assessment_payload()
        payload["parentCarerSeen"] = "No"

        with self.assertRaises(ValidationError):
            clean_assessment_draft(payload)

    def test_submission_allows_an_optional_section_to_be_empty(self):
        cleaned = clean_assessment_draft(complete_assessment_payload())
        cleaned["familyFunctioning"] = ""

        validate_assessment_submission(cleaned)

    def test_cleaning_removes_retired_information_status_fields(self):
        payload = complete_assessment_payload()
        payload["familyFunctioningStatus"] = "information_unavailable"
        payload["familyFunctioningUnavailableReason"] = "The family could not be reached."
        cleaned = clean_assessment_draft(payload)

        self.assertNotIn("familyFunctioningStatus", cleaned)
        self.assertNotIn("familyFunctioningUnavailableReason", cleaned)

    def test_complete_approved_assessment_is_valid(self):
        validate_assessment_submission(clean_assessment_draft(complete_assessment_payload()))


class CarePlanSchemaTests(SimpleTestCase):
    def test_action_plan_notes_are_saved_under_the_manual_field_name(self):
        cleaned = normalize_care_plan_item({"actionPlanNotes": "Arrange weekly counselling."})

        self.assertEqual(cleaned["actionPlanNotes"], "Arrange weekly counselling.")
        self.assertNotIn("expectedOutcome", cleaned)

    def test_legacy_expected_outcome_is_preserved_as_action_plan_notes(self):
        cleaned = normalize_care_plan_item({"expectedOutcome": "The child returns to school."})

        self.assertEqual(cleaned["actionPlanNotes"], "The child returns to school.")


class NotificationRecipientScopeTests(APITestCase):
    def setUp(self):
        self.province = Province.objects.create(name="Test Province", code="TP")
        self.district = District.objects.create(province=self.province, name="Target District", code="TD")
        self.other_district = District.objects.create(province=self.province, name="Other District", code="OD")

    def create_profiled_user(self, username, role, district=None):
        user = get_user_model().objects.create_user(username=username, password="test-password")
        UserProfile.objects.create(user=user, role=role, province=self.province, district=district)
        return user

    def test_district_notification_only_selects_head_of_target_district(self):
        target_head = self.create_profiled_user("target-head", UserProfile.Role.DISTRICT_HEAD, self.district)
        self.create_profiled_user("other-head", UserProfile.Role.DISTRICT_HEAD, self.other_district)
        self.create_profiled_user("system-admin", UserProfile.Role.SYS_ADMIN)
        self.create_profiled_user("provincial-head", UserProfile.Role.PROVINCIAL_HEAD)

        recipients = notification_recipients([UserProfile.Role.DISTRICT_HEAD], district=self.district)

        self.assertQuerySetEqual(recipients, [target_head], transform=lambda user: user, ordered=False)


class IntakeUpdateRequestApprovalTests(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username="case-officer", password="test-password")
        self.intake = Intake.objects.create(
            temporary_case_reference="HC/2026/TEST-001",
            created_by=self.user,
            status=Intake.Status.ALLOCATED,
            background_information={"previous_contacts": {"dcwps": {"has_contact": "No", "reason": ""}}},
        )

    def test_non_allocated_officer_cannot_submit_an_update_request(self):
        other_user = get_user_model().objects.create_user(username="other-officer", password="test-password")
        self.client.force_authenticate(other_user)

        response = self.client.post("/api/update-requests/", {
            "intake": self.intake.id,
            "tab": "Background Information",
            "reason": "New information received",
            "requested_fields": [],
        }, format="json")

        self.assertEqual(response.status_code, 403)
        self.assertEqual(UpdateRequest.objects.count(), 0)

    def test_pending_request_does_not_change_the_live_case_or_status(self):
        request = UpdateRequest.objects.create(
            intake=self.intake,
            tab="Background Information",
            requested_by=self.user,
            reason="New information received",
            requested_fields=[{
                "path": "background_information.previous_contacts.dcwps.has_contact",
                "label": "DCWPS",
                "old_value": "No",
                "proposed_value": "Yes",
            }],
        )

        self.intake.refresh_from_db()
        self.assertEqual(request.status, UpdateRequest.Status.PENDING)
        self.assertEqual(self.intake.status, Intake.Status.ALLOCATED)
        self.assertEqual(self.intake.background_information["previous_contacts"]["dcwps"]["has_contact"], "No")

        apply_intake_update_request(request)
        self.intake.refresh_from_db()
        self.assertEqual(self.intake.status, Intake.Status.ALLOCATED)
        self.assertEqual(self.intake.background_information["previous_contacts"]["dcwps"]["has_contact"], "Yes")
