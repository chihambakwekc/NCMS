# The safeguarding classification now determines priority; the retired
# Immediate Needs intake module no longer stores its own action-plan fields.

from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [("core", "0057_remove_intake_prior_assistance")]

    operations = [
        migrations.RemoveField(model_name="intake", name="immediate_action_required"),
        migrations.RemoveField(model_name="intake", name="immediate_action_plan"),
    ]
