from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [("core", "0058_remove_intake_immediate_needs")]

    operations = [migrations.RemoveField(model_name="intake", name="child_moved_to_safety")]
