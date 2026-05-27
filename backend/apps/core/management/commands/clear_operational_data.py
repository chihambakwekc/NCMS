from django.core.management.base import BaseCommand
from django.core.management.color import no_style
from django.db import connection

from apps.core.models import Alert, AuditLog, CalendarTask, Intake, MoreInformationRequest


class Command(BaseCommand):
    help = "Clear captured operational records while keeping users, roles, profiles, organizations, districts, wards, and provinces."

    def add_arguments(self, parser):
        parser.add_argument("--confirm", action="store_true", help="Required to delete operational data.")

    def handle(self, *args, **options):
        if not options["confirm"]:
            self.stdout.write(self.style.WARNING("Nothing deleted. Re-run with --confirm to clear operational data."))
            return

        counts = {
            "information_requests": MoreInformationRequest.objects.count(),
            "intakes": Intake.objects.count(),
            "alerts": Alert.objects.count(),
            "calendar_tasks": CalendarTask.objects.count(),
            "audit_logs": AuditLog.objects.count(),
        }
        MoreInformationRequest.objects.all().delete()
        Intake.objects.all().delete()
        Alert.objects.all().delete()
        CalendarTask.objects.all().delete()
        AuditLog.objects.all().delete()
        sequence_sql = connection.ops.sequence_reset_sql(no_style(), [Alert, AuditLog, CalendarTask, Intake, MoreInformationRequest])
        with connection.cursor() as cursor:
            for statement in sequence_sql:
                cursor.execute(statement)

        self.stdout.write(self.style.SUCCESS(
            "Cleared operational data: "
            f"{counts['information_requests']} information requests, "
            f"{counts['intakes']} intakes, "
            f"{counts['alerts']} alerts, "
            f"{counts['calendar_tasks']} calendar tasks, "
            f"{counts['audit_logs']} audit logs."
        ))
