from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.core.models import (
    Alert,
    CaseNumberSequence,
    CommunityChildcareWorker,
    Court,
    District,
    Organization,
    PartnersInDistrict,
    Province,
    UserProfile,
    Ward,
)


class Command(BaseCommand):
    help = "Delete Province/District master data and dependent geography setup records."

    def add_arguments(self, parser):
        parser.add_argument("--yes", action="store_true", help="Confirm this destructive operation.")
        parser.add_argument(
            "--force-alert-unassign",
            action="store_true",
            help="Also clear district assignments on alerts. Use only when you intentionally reset case geography.",
        )

    def handle(self, *args, **options):
        if not options["yes"]:
            raise CommandError("Refusing to delete data. Re-run with --yes after taking a database backup.")

        alert_count = Alert.objects.filter(district__isnull=False).count()
        if alert_count and not options["force_alert_unassign"]:
            raise CommandError(
                f"{alert_count} alert(s) still reference a district. No data was changed. "
                "Either preserve those cases or re-run with --force-alert-unassign."
            )

        with transaction.atomic():
            counts = {
                "profiles_unassigned": UserProfile.objects.filter(
                    province__isnull=False
                ).update(province=None, district=None, ward=None),
                "organizations_unassigned": Organization.objects.filter(district__isnull=False).update(district=None),
                "alerts_unassigned": 0,
                "ccws_deleted": CommunityChildcareWorker.objects.count(),
                "courts_deleted": Court.objects.count(),
                "partners_deleted": PartnersInDistrict.objects.count(),
                "wards_deleted": Ward.objects.count(),
                "case_sequences_deleted": CaseNumberSequence.objects.count(),
                "districts_deleted": District.objects.count(),
                "provinces_deleted": Province.objects.count(),
            }
            if options["force_alert_unassign"]:
                counts["alerts_unassigned"] = Alert.objects.filter(district__isnull=False).update(district=None)

            CommunityChildcareWorker.objects.all().delete()
            Court.objects.all().delete()
            PartnersInDistrict.objects.all().delete()
            Ward.objects.all().delete()
            CaseNumberSequence.objects.all().delete()
            District.objects.all().delete()
            Province.objects.all().delete()

        self.stdout.write(self.style.SUCCESS(f"Geography reset complete: {counts}"))
