from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [("quotes", "0002_snapshot_guards")]
    operations = [
        migrations.RunSQL(
            """
CREATE OR REPLACE FUNCTION qg_finalised_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'finalised' THEN RAISE EXCEPTION 'Finalised quotation versions are immutable'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
""",
            migrations.RunSQL.noop,
        )
    ]
