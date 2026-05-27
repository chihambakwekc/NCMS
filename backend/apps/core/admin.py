from django.contrib import admin

from .models import Alert, AuditLog, District, Intake, MoreInformationRequest, Organization, Province, UpdateRequest, UserProfile, Ward


@admin.register(UserProfile)
class UserProfileAdmin(admin.ModelAdmin):
    list_display = ("user", "role", "organization", "district", "ward", "active")
    list_filter = ("role", "active", "district")
    search_fields = ("user__username", "user__first_name", "user__last_name", "phone")


@admin.register(Alert)
class AlertAdmin(admin.ModelAdmin):
    list_display = ("reference", "child_display_name", "district", "status", "internal_status", "emergency", "created_at")
    list_filter = ("status", "internal_status", "emergency", "district")
    search_fields = ("reference", "child_first_name", "child_surname", "description")


@admin.register(Intake)
class IntakeAdmin(admin.ModelAdmin):
    list_display = ("temporary_case_reference", "alert", "status", "risk_level", "allocated_officer", "created_at")
    list_filter = ("status", "risk_level", "immediate_action_required")
    search_fields = ("temporary_case_reference", "alert__reference")


admin.site.register(Province)
admin.site.register(District)
admin.site.register(Ward)
admin.site.register(Organization)
admin.site.register(MoreInformationRequest)
admin.site.register(AuditLog)
admin.site.register(UpdateRequest)
