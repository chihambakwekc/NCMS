from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    AlertViewSet,
    AuditLogViewSet,
    CalendarTaskViewSet,
    ChangePasswordView,
    CommunityChildcareWorkerViewSet,
    CourtViewSet,
    DistrictViewSet,
    HealthView,
    IntakeViewSet,
    LoginView,
    LocationMasterDataView,
    MeView,
    MoreInformationRequestViewSet,
    NationalDashboardView,
    ProvinceDashboardView,
    DistrictDashboardView,
    OfficerDashboardView,
    NotificationRuleViewSet,
    NotificationViewSet,
    OrganizationViewSet,
    PartnersInDistrictViewSet,
    ProvinceViewSet,
    RelationshipTypeViewSet,
    ReportGenerationViewSet,
    ReportsAnalyticsView,
    ReportsExcelExportView,
    ReportsPdfExportView,
    UpdateRequestViewSet,
    UserViewSet,
    WardViewSet,
)

router = DefaultRouter()
router.register("alerts", AlertViewSet, basename="alert")
router.register("intakes", IntakeViewSet, basename="intake")
router.register("information-requests", MoreInformationRequestViewSet, basename="information-request")
router.register("notifications", NotificationViewSet, basename="notification")
router.register("notification-rules", NotificationRuleViewSet, basename="notification-rule")
router.register("update-requests", UpdateRequestViewSet, basename="update-request")
router.register("users", UserViewSet, basename="user")
router.register("provinces", ProvinceViewSet, basename="province")
router.register("districts", DistrictViewSet, basename="district")
router.register("wards", WardViewSet, basename="ward")
router.register("ccws", CommunityChildcareWorkerViewSet, basename="ccw")
router.register("partners-in-district", PartnersInDistrictViewSet, basename="partners-in-district")
router.register("courts", CourtViewSet, basename="court")
router.register("organizations", OrganizationViewSet, basename="organization")
router.register("relationship-types", RelationshipTypeViewSet, basename="relationship-type")
router.register("audit-logs", AuditLogViewSet, basename="audit-log")
router.register("report-history", ReportGenerationViewSet, basename="report-history")
router.register("calendar-tasks", CalendarTaskViewSet, basename="calendar-task")

urlpatterns = [
    path("health/", HealthView.as_view(), name="health"),
    path("auth/login/", LoginView.as_view(), name="login"),
    path("auth/change-password/", ChangePasswordView.as_view(), name="change-password"),
    path("auth/me/", MeView.as_view(), name="me"),
    path("master-data/locations/", LocationMasterDataView.as_view(), name="master-data-locations"),
    path("dashboard/national/", NationalDashboardView.as_view(), name="national-dashboard"),
    path("dashboard/province/<int:province_id>/", ProvinceDashboardView.as_view(), name="province-dashboard"),
    path("dashboard/district/<int:district_id>/", DistrictDashboardView.as_view(), name="district-dashboard"),
    path("dashboard/officer/<int:officer_id>/", OfficerDashboardView.as_view(), name="officer-dashboard"),
    path("reports/analytics/", ReportsAnalyticsView.as_view(), name="reports-analytics"),
    path("reports/export/excel/", ReportsExcelExportView.as_view(), name="reports-export-excel"),
    path("reports/export/pdf/", ReportsPdfExportView.as_view(), name="reports-export-pdf"),
    path("", include(router.urls)),
]
