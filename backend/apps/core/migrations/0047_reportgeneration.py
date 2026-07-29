from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0046_calendartask_district"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="ReportGeneration",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("reference", models.CharField(max_length=40, unique=True)),
                ("report_type", models.CharField(max_length=80)),
                ("report_title", models.CharField(max_length=180)),
                ("output_format", models.CharField(choices=[("PDF", "PDF"), ("EXCEL", "Excel")], max_length=12)),
                ("filters", models.JSONField(blank=True, default=dict)),
                ("summary", models.JSONField(blank=True, default=dict)),
                ("generated_at", models.DateTimeField(auto_now_add=True)),
                ("district", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="generated_reports", to="core.district")),
                ("generated_by", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="generated_reports", to=settings.AUTH_USER_MODEL)),
                ("province", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="generated_reports", to="core.province")),
            ],
            options={
                "ordering": ("-generated_at", "-id"),
            },
        ),
    ]
