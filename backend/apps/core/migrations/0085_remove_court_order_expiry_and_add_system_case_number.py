from django.db import migrations


def normalize_court_order_numbers(apps, schema_editor):
    Intake = apps.get_model("core", "Intake")
    for intake in Intake.objects.exclude(justice_draft={}).iterator():
        justice = intake.justice_draft if isinstance(intake.justice_draft, dict) else {}
        orders = justice.get("courtOrders") if isinstance(justice.get("courtOrders"), list) else []
        changed = False
        cleaned_orders = []
        for value in orders:
            if not isinstance(value, dict):
                continue
            order = dict(value)
            if "expiryDate" in order or "expiry_date" in order:
                changed = True
            order.pop("expiryDate", None)
            order.pop("expiry_date", None)
            if order.get("systemCaseNumber") != intake.temporary_case_reference:
                order["systemCaseNumber"] = intake.temporary_case_reference
                changed = True
            cleaned_orders.append(order)
        if changed:
            intake.justice_draft = {"courtOrders": cleaned_orders}
            intake.save(update_fields=["justice_draft"])


class Migration(migrations.Migration):
    dependencies = [("core", "0084_simplify_case_notes")]

    operations = [migrations.RunPython(normalize_court_order_numbers, migrations.RunPython.noop)]
