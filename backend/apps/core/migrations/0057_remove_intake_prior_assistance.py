# Replaces the previous-involvement JSON column with structured contact data
# held in Intake.background_information.previous_contacts.

from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [("core", "0056_intake_safeguarding_classification")]

    operations = [migrations.RemoveField(model_name="intake", name="prior_assistance")]
