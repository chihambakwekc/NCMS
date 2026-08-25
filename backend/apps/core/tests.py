from django.contrib.auth import get_user_model
from datetime import timedelta

from django.test import SimpleTestCase
from django.utils import timezone
from rest_framework.exceptions import ValidationError
from rest_framework.test import APITestCase

from .views import (
    ASSESSMENT_NARRATIVE_FIELDS,
    ASSESSMENT_SCHEMA_VERSION,
    apply_intake_update_request,
    clean_assessment_draft,
    clean_service_tracking,
    implementation_allows_follow_up,
    follow_up_links_eligible_intervention,
    missing_required_referrals,
    maybe_notify_emergency_draft_reminders,
    normalize_care_plan_item,
    notification_recipients,
    validate_assessment_submission,
)
from .models import District, Intake, Notification, Province, UpdateRequest, UserProfile


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

    def test_legacy_accepted_implementation_is_normalized_to_referred(self):
        cleaned = clean_service_tracking(
            [{"status": "Accepted"}],
            {"items": [{"assistanceType": "Counselling"}]},
        )

        self.assertEqual(cleaned[0]["status"], "Referred")

    def test_follow_up_requires_referred_in_progress_or_completed_work(self):
        self.assertFalse(implementation_allows_follow_up([{"status": "Planned"}, {"status": "Cancelled"}]))
        for status in ("Referred", "In Progress", "Completed"):
            with self.subTest(status=status):
                self.assertTrue(implementation_allows_follow_up([{"status": status}]))

    def test_follow_up_must_link_to_an_eligible_care_plan_activity(self):
        services = [
            {"plannedAction": "Counselling", "status": "In Progress"},
            {"plannedAction": "Education Support", "status": "Planned"},
        ]

        self.assertTrue(follow_up_links_eligible_intervention({"carePlanItemFollowedUp": "Counselling"}, services))
        self.assertFalse(follow_up_links_eligible_intervention({"carePlanItemFollowedUp": "Education Support"}, services))
        self.assertFalse(follow_up_links_eligible_intervention({}, services))

    def test_external_responsibility_automatically_requires_referral(self):
        cleaned = normalize_care_plan_item({"assistanceType": "Counselling", "responsiblePerson": "NGO Partner"})

        self.assertEqual(cleaned["referralRequired"], "Yes")

    def test_internal_responsibility_does_not_require_referral(self):
        cleaned = normalize_care_plan_item({"assistanceType": "Counselling", "responsiblePerson": "DSDO"})

        self.assertEqual(cleaned["referralRequired"], "No")

    def test_external_activity_cannot_progress_without_recorded_referral(self):
        care_plan = {"items": [normalize_care_plan_item({"assistanceType": "Counselling", "responsiblePerson": "NGO Partner"})]}
        services = [{"plannedAction": "Counselling", "status": "In Progress"}]

        self.assertEqual(missing_required_referrals(care_plan, [], services), ["Counselling"])
        self.assertEqual(missing_required_referrals(care_plan, [{"linkedCarePlanItem": "Counselling"}], services), [])


class EmergencyDraftReminderTests(APITestCase):
    def setUp(self):
        self.province = Province.objects.create(name="Reminder Province", code="RP")
        self.district = District.objects.create(province=self.province, name="Reminder District", code="RD")
        self.officer = get_user_model().objects.create_user(username="reminder-officer", password="test-password")
        UserProfile.objects.create(user=self.officer, role=UserProfile.Role.DSDO, province=self.province, district=self.district)
        self.intake = Intake.objects.create(
            temporary_case_reference="RD/2026/0001",
            created_by=self.officer,
            status=Intake.Status.DRAFT,
            is_emergency=True,
        )

    def age_intake(self, age):
        Intake.objects.filter(pk=self.intake.pk).update(created_at=timezone.now() - age)
        self.intake.refresh_from_db()

    def test_repeated_checks_keep_one_active_reminder(self):
        self.age_intake(timedelta(hours=50))

        maybe_notify_emergency_draft_reminders(self.officer)
        maybe_notify_emergency_draft_reminders(self.officer)

        reminders = Notification.objects.filter(recipient=self.officer, dedupe_key__icontains="emergency-draft-reminder", resolved_at__isnull=True)
        self.assertEqual(reminders.count(), 1)
        self.assertIn("Overdue", reminders.get().message)

    def test_reminder_resolves_after_seven_days(self):
        self.age_intake(timedelta(days=6))
        maybe_notify_emergency_draft_reminders(self.officer)
        self.assertEqual(Notification.objects.filter(recipient=self.officer, resolved_at__isnull=True).count(), 1)

        self.age_intake(timedelta(days=7, minutes=1))
        maybe_notify_emergency_draft_reminders(self.officer)

        self.assertEqual(Notification.objects.filter(recipient=self.officer, resolved_at__isnull=True).count(), 0)


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


class NationalVisibilityTests(APITestCase):
    def setUp(self):
        self.province = Province.objects.create(name="National Test Province", code="NTP")
        self.district = District.objects.create(province=self.province, name="National Test District", code="NTD")
        self.creator = get_user_model().objects.create_user(username="intake-creator", password="test-password")
        UserProfile.objects.create(user=self.creator, role=UserProfile.Role.DSDO, province=self.province, district=self.district)
        Intake.objects.create(temporary_case_reference="NTD/2026/0001", created_by=self.creator)

    def create_national_user(self, role, *, is_superuser=False):
        user = get_user_model().objects.create_user(
            username=f"national-{role.lower()}",
            password="test-password",
            is_staff=is_superuser,
            is_superuser=is_superuser,
        )
        UserProfile.objects.create(user=user, role=role)
        return user

    def test_every_national_head_office_role_sees_all_users_and_intakes(self):
        roles = [
            UserProfile.Role.SYS_ADMIN,
            UserProfile.Role.DEPUTY_DIRECTOR,
            UserProfile.Role.DIRECTOR,
            UserProfile.Role.PROGRAMME_OFFICER,
        ]
        national_users = [self.create_national_user(role) for role in roles]

        for user in national_users:
            with self.subTest(role=user.profile.role):
                self.client.force_authenticate(user)
                self.assertEqual(self.client.get("/api/users/").status_code, 200)
                self.assertEqual(len(self.client.get("/api/users/").data), len(national_users) + 1)
                self.assertEqual(self.client.get("/api/intakes/").status_code, 200)
                self.assertEqual(len(self.client.get("/api/intakes/").data), 1)

    def test_only_system_administrator_can_create_users(self):
        director = self.create_national_user(UserProfile.Role.DIRECTOR)
        self.client.force_authenticate(director)

        response = self.client.post("/api/users/", {}, format="json")

        self.assertEqual(response.status_code, 403)

    def test_django_superuser_keeps_national_visibility_if_profile_role_is_stale(self):
        superuser = self.create_national_user(UserProfile.Role.DSDO, is_superuser=True)
        superuser.profile.province = self.province
        superuser.profile.district = self.district
        superuser.profile.save(update_fields=["province", "district"])
        self.client.force_authenticate(superuser)

        self.assertEqual(len(self.client.get("/api/users/").data), 2)
        self.assertEqual(len(self.client.get("/api/intakes/").data), 1)


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
