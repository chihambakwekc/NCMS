from django.contrib.auth import get_user_model
from datetime import timedelta

from django.test import SimpleTestCase
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework.exceptions import ValidationError
from rest_framework.test import APITestCase

from .views import (
    ASSESSMENT_NARRATIVE_FIELDS,
    ASSESSMENT_SCHEMA_VERSION,
    apply_intake_update_request,
    clean_assessment_draft,
    clean_justice_draft,
    clean_service_tracking,
    implementation_allows_follow_up,
    follow_up_links_eligible_intervention,
    missing_required_referrals,
    maybe_notify_emergency_draft_reminders,
    next_case_reference,
    normalize_care_plan_item,
    notify_case_allocated,
    notification_recipients,
    reconcile_case_notes_draft,
    validate_assessment_submission,
)
from .models import CalendarTask, District, Intake, Notification, Province, UpdateRequest, UserProfile


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


class CaseReferenceTests(APITestCase):
    def test_case_reference_uses_cw_sequence_without_padding_and_short_year(self):
        province = Province.objects.create(name="Case Reference Province", code="CRP")
        district = District.objects.create(province=province, name="Case Reference District", code="CR")
        short_year = timezone.now().strftime("%y")

        self.assertEqual(next_case_reference(district), f"CR/CW/1/{short_year}")
        self.assertEqual(next_case_reference(district), f"CR/CW/2/{short_year}")


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


class CaseNoteImmutabilityTests(SimpleTestCase):
    def test_note_can_be_edited_and_deleted_during_first_24_hours(self):
        recent = (timezone.now() - timedelta(hours=23)).isoformat()
        existing = [{"id": "note-1", "caseNote": "Original", "createdAt": recent}]

        edited = reconcile_case_notes_draft(existing, [{"id": "note-1", "caseNote": "Corrected", "createdAt": recent}])
        deleted = reconcile_case_notes_draft(existing, [])

        self.assertEqual(edited[0]["caseNote"], "Corrected")
        self.assertEqual(deleted, [])

    def test_note_cannot_be_edited_or_deleted_after_24_hours(self):
        old = (timezone.now() - timedelta(hours=25)).isoformat()
        existing = [{"id": "note-1", "caseNote": "Original evidence", "createdAt": old}]

        edited = reconcile_case_notes_draft(existing, [{"id": "note-1", "caseNote": "Rewritten", "createdAt": old}])
        deleted = reconcile_case_notes_draft(existing, [])

        self.assertEqual(edited[0]["caseNote"], "Original evidence")
        self.assertEqual(deleted[0]["caseNote"], "Original evidence")

    def test_server_assigns_creation_time_to_new_note(self):
        saved = reconcile_case_notes_draft([], [{"id": "client-note", "caseNote": "New note", "createdAt": "2000-01-01T00:00:00Z"}])

        self.assertEqual(saved[0]["caseNote"], "New note")
        self.assertNotEqual(saved[0]["id"], "client-note")
        self.assertLess(timezone.now() - parse_datetime(saved[0]["createdAt"]), timedelta(seconds=2))


class CourtOrderSchemaTests(SimpleTestCase):
    def test_expiry_is_removed_and_system_case_number_is_derived(self):
        cleaned = clean_justice_draft({
            "courtOrders": [{
                "id": "order-1",
                "courtCaseNumber": "CRT-42/2026",
                "systemCaseNumber": "tampered-value",
                "expiryDate": "2027-01-01",
            }],
        }, "HC/2026/0003")

        order = cleaned["courtOrders"][0]
        self.assertEqual(order["systemCaseNumber"], "HC/2026/0003")
        self.assertEqual(order["courtCaseNumber"], "CRT-42/2026")
        self.assertNotIn("expiryDate", order)


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

    def test_system_administrator_sees_intakes_from_every_province(self):
        other_province = Province.objects.create(name="Other National Province", code="ONP")
        other_district = District.objects.create(province=other_province, name="Other National District", code="OND")
        other_creator = self.create_profiled_user("other-intake-creator", UserProfile.Role.DSDO, other_district)
        Intake.objects.create(temporary_case_reference="OND/2026/0001", created_by=other_creator)
        administrator = self.create_national_user(UserProfile.Role.SYS_ADMIN)
        self.client.force_authenticate(administrator)

        response = self.client.get("/api/intakes/")

        self.assertEqual(response.status_code, 200)
        self.assertSetEqual(
            {item["temporaryCaseReference"] for item in response.data},
            {"NTD/2026/0001", "OND/2026/0001"},
        )

    def test_national_dashboard_returns_authoritative_national_aggregates(self):
        administrator = self.create_national_user(UserProfile.Role.SYS_ADMIN)
        self.client.force_authenticate(administrator)

        response = self.client.get("/api/dashboard/national/?months=6")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["kpis"]["active"], 1)
        self.assertEqual(response.data["kpis"]["newCases"], 1)
        self.assertEqual(len(response.data["trend"]), 6)
        province = next(row for row in response.data["children"] if row["name"] == self.province.name)
        self.assertEqual(province["active"], 1)
        self.assertEqual(response.data["scope"]["type"], "national")

    def test_provincial_dashboard_rejects_another_province(self):
        other_province = Province.objects.create(name="Restricted Province", code="RSP")
        provincial_head = get_user_model().objects.create_user(username="provincial-head-scope", password="test-password")
        UserProfile.objects.create(user=provincial_head, role=UserProfile.Role.PROVINCIAL_HEAD, province=self.province)
        self.client.force_authenticate(provincial_head)

        allowed = self.client.get(f"/api/dashboard/province/{self.province.id}/")
        denied = self.client.get(f"/api/dashboard/province/{other_province.id}/")

        self.assertEqual(allowed.status_code, 200)
        self.assertEqual(denied.status_code, 403)

    def test_district_head_can_only_open_their_district_dashboard(self):
        other_district = District.objects.create(province=self.province, name="Restricted District", code="RSD")
        district_head = get_user_model().objects.create_user(username="district-head-scope", password="test-password")
        UserProfile.objects.create(user=district_head, role=UserProfile.Role.DISTRICT_HEAD, province=self.province, district=self.district)
        self.client.force_authenticate(district_head)

        self.assertEqual(self.client.get(f"/api/dashboard/district/{self.district.id}/").status_code, 200)
        self.assertEqual(self.client.get(f"/api/dashboard/district/{other_district.id}/").status_code, 403)

    def test_district_user_cannot_open_national_dashboard(self):
        self.client.force_authenticate(self.creator)

        response = self.client.get("/api/dashboard/national/")

        self.assertEqual(response.status_code, 403)


    def test_user_list_keeps_newest_accounts_first_after_reload(self):
        administrator = self.create_national_user(UserProfile.Role.SYS_ADMIN)
        older_user = self.create_national_user(UserProfile.Role.DIRECTOR)
        newer_user = self.create_national_user(UserProfile.Role.PROGRAMME_OFFICER)
        get_user_model().objects.filter(id=older_user.id).update(date_joined=timezone.now() - timedelta(days=1))
        get_user_model().objects.filter(id=newer_user.id).update(date_joined=timezone.now())
        self.client.force_authenticate(administrator)

        response = self.client.get("/api/users/")

        self.assertEqual(response.status_code, 200)
        returned_ids = [item["id"] for item in response.data]
        self.assertLess(returned_ids.index(newer_user.id), returned_ids.index(older_user.id))

    def test_django_superuser_keeps_national_visibility_if_profile_role_is_stale(self):
        superuser = self.create_national_user(UserProfile.Role.DSDO, is_superuser=True)
        superuser.profile.province = self.province
        superuser.profile.district = self.district
        superuser.profile.save(update_fields=["province", "district"])
        self.client.force_authenticate(superuser)

        self.assertEqual(len(self.client.get("/api/users/").data), 2)
        self.assertEqual(len(self.client.get("/api/intakes/").data), 1)


class OfficerCalendarTaskScopeTests(APITestCase):
    def setUp(self):
        province = Province.objects.create(name="Calendar Province", code="CP")
        district = District.objects.create(province=province, name="Calendar District", code="CD")
        self.officer = get_user_model().objects.create_user(username="calendar-officer", password="test-password")
        self.other_officer = get_user_model().objects.create_user(username="other-calendar-officer", password="test-password")
        UserProfile.objects.create(user=self.officer, role=UserProfile.Role.DSDO, province=province, district=district)
        UserProfile.objects.create(user=self.other_officer, role=UserProfile.Role.DSDO, province=province, district=district)
        self.own_intake = Intake.objects.create(
            temporary_case_reference="CD/2026/0001",
            created_by=self.officer,
            allocated_officer=self.officer,
            status=Intake.Status.ALLOCATED,
        )
        self.other_intake = Intake.objects.create(
            temporary_case_reference="CD/2026/0002",
            created_by=self.other_officer,
            allocated_officer=self.other_officer,
            status=Intake.Status.ALLOCATED,
        )
        CalendarTask.objects.create(title="Own task", date="2026-08-28", source=self.own_intake.temporary_case_reference, district=district, created_by=self.officer)
        CalendarTask.objects.create(title="Other task", date="2026-08-28", source=self.other_intake.temporary_case_reference, district=district, created_by=self.other_officer)
        self.client.force_authenticate(self.officer)

    def test_officer_only_sees_tasks_for_cases_allocated_to_them(self):
        response = self.client.get("/api/calendar-tasks/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual([task["source"] for task in response.data], [self.own_intake.temporary_case_reference])

    def test_officer_cannot_create_task_for_another_officers_case(self):
        response = self.client.post("/api/calendar-tasks/", {
            "title": "Unauthorized task",
            "date": "2026-08-29",
            "source": self.other_intake.temporary_case_reference,
        }, format="json")

        self.assertEqual(response.status_code, 403)


class CaseInsensitiveAuthenticationTests(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username="Kudah.Admin",
            email="Kudah@example.com",
            password="test-password",
        )
        UserProfile.objects.create(user=self.user, role=UserProfile.Role.SYS_ADMIN)

    def test_login_username_is_case_insensitive(self):
        response = self.client.post("/api/auth/login/", {
            "username": "kUdAh.AdMiN",
            "password": "test-password",
            "portal": "internal",
        }, format="json")

        self.assertEqual(response.status_code, 200)

    def test_login_email_is_case_insensitive(self):
        response = self.client.post("/api/auth/login/", {
            "username": "KUDAH@EXAMPLE.COM",
            "password": "test-password",
            "portal": "internal",
        }, format="json")

        self.assertEqual(response.status_code, 200)


class IntakeCaseTypeSubmissionTests(APITestCase):
    def setUp(self):
        self.province = Province.objects.create(name="Case Type Province", code="CTP")
        self.district = District.objects.create(province=self.province, name="Case Type District", code="CTD")
        self.officer = get_user_model().objects.create_user(username="case-type-officer", password="test-password")
        UserProfile.objects.create(
            user=self.officer,
            role=UserProfile.Role.DSDO,
            province=self.province,
            district=self.district,
        )
        self.intake = Intake.objects.create(
            temporary_case_reference="CTD/2026/0001",
            created_by=self.officer,
            status=Intake.Status.DRAFT,
            opening_summary={"screening_draft": {"selected_categories": []}},
        )
        self.client.force_authenticate(self.officer)

    def test_submission_without_a_case_type_is_rejected(self):
        response = self.client.patch(
            f"/api/intakes/{self.intake.id}/",
            {
                "status": Intake.Status.SUPERVISOR_REVIEW,
                "opening_summary": {"screening_draft": {"selected_categories": []}},
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("case_type", response.data)
        self.intake.refresh_from_db()
        self.assertEqual(self.intake.status, Intake.Status.DRAFT)

    def test_submission_with_a_case_type_is_allowed(self):
        response = self.client.patch(
            f"/api/intakes/{self.intake.id}/",
            {
                "status": Intake.Status.SUPERVISOR_REVIEW,
                "opening_summary": {"screening_draft": {"selected_categories": ["Neglect"]}},
                "case_category": "Neglect",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.intake.refresh_from_db()
        self.assertEqual(self.intake.status, Intake.Status.SUPERVISOR_REVIEW)

    def test_intake_response_identifies_the_recorded_creator(self):
        response = self.client.get(f"/api/intakes/{self.intake.id}/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["createdBy"]["id"], self.officer.id)
        self.assertEqual(response.data["createdBy"]["username"], self.officer.username)
        self.assertEqual(response.data["createdBy"]["roleLabel"], self.officer.profile.get_role_display())


class AssessmentCarePlanReviewWorkflowTests(APITestCase):
    def setUp(self):
        self.province = Province.objects.create(name="Review Province", code="RVP")
        self.district = District.objects.create(province=self.province, name="Review District", code="RVD")
        self.supervisor = get_user_model().objects.create_user(username="review-dsdo", password="test-password")
        UserProfile.objects.create(user=self.supervisor, role=UserProfile.Role.DISTRICT_HEAD, province=self.province, district=self.district)
        self.officer = get_user_model().objects.create_user(username="allocated-sdo", password="test-password")
        UserProfile.objects.create(user=self.officer, role=UserProfile.Role.DSDO, province=self.province, district=self.district)
        self.intake = Intake.objects.create(
            temporary_case_reference="RVD/2026/0001",
            created_by=self.officer,
            allocated_officer=self.officer,
            allocated_at=timezone.now(),
            status=Intake.Status.ALLOCATED,
            assessment_care_plan_status="Submitted",
            assessment_draft={},
            care_plan_draft={"items": [{"assistanceType": "Counselling", "plannedAction": "Provide counselling"}]},
        )
        self.client.force_authenticate(self.supervisor)

    def review(self, stage, decision, notes=""):
        return self.client.post(
            f"/api/intakes/{self.intake.id}/review-assessment-care-plan/",
            {"stage": stage, "decision": decision, "notes": notes},
            format="json",
        )

    def test_sdo_is_notified_after_both_approvals(self):
        self.assertEqual(self.review("assessment", "approve").status_code, 200)
        self.assertFalse(Notification.objects.filter(recipient=self.officer, title="Assessment and care plan approved").exists())

        response = self.review("care_plan", "approve")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["assessment_care_plan_status"], "Approved")
        notification = Notification.objects.get(recipient=self.officer, title="Assessment and care plan approved")
        self.assertEqual(notification.route, "allocated-cases")
        self.assertEqual(notification.target_id, str(self.intake.id))

    def test_sdo_is_notified_when_revision_is_requested(self):
        response = self.review("assessment", "request_revision", "Please correct the assessment.")

        self.assertEqual(response.status_code, 200)
        notification = Notification.objects.get(recipient=self.officer, title="Assessment returned for revision")
        self.assertIn("Please correct the assessment.", notification.message)
        self.assertEqual(notification.action_label, "Revise submission")

    def test_care_plan_revision_notification_identifies_the_returned_stage(self):
        self.assertEqual(self.review("assessment", "approve").status_code, 200)

        response = self.review("care_plan", "request_revision", "Please correct the care plan.")

        self.assertEqual(response.status_code, 200)
        notification = Notification.objects.get(recipient=self.officer, title="Care plan returned for revision")
        self.assertIn("Please correct the care plan.", notification.message)

    def test_allocation_notification_opens_allocated_case_workspace(self):
        notify_case_allocated(self.intake)

        notification = Notification.objects.get(recipient=self.officer, title="Case allocated to you")
        self.assertEqual(notification.route, "allocated-cases")
        self.assertEqual(notification.action_label, "Open allocated case")


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
