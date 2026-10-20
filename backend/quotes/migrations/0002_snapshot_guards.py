from django.db import migrations

SQL = """
CREATE FUNCTION qg_finalised_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'finalised' THEN
    RAISE EXCEPTION 'Finalised quotation versions are immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER qg_finalised_guard BEFORE UPDATE OR DELETE ON quotes_quote FOR EACH ROW EXECUTE FUNCTION qg_finalised_guard();
CREATE FUNCTION qg_cost_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE quote_state text;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    SELECT status INTO quote_state FROM quotes_quote WHERE id = OLD.quote_id FOR UPDATE;
    IF quote_state = 'finalised' THEN RAISE EXCEPTION 'Finalised costs are immutable'; END IF;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    SELECT status INTO quote_state FROM quotes_quote WHERE id = NEW.quote_id FOR UPDATE;
    IF quote_state = 'finalised' THEN RAISE EXCEPTION 'Finalised costs are immutable'; END IF;
    RETURN NEW;
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER qg_cost_guard BEFORE INSERT OR UPDATE OR DELETE ON quotes_costitem FOR EACH ROW EXECUTE FUNCTION qg_cost_guard();
ALTER TABLE quotes_quote ADD CONSTRAINT qg_status CHECK (status IN ('draft','finalised','archived'));
ALTER TABLE quotes_quote ADD CONSTRAINT qg_snapshot CHECK (status <> 'finalised' OR snapshot IS NOT NULL);
"""
REVERSE = """
ALTER TABLE quotes_quote DROP CONSTRAINT qg_snapshot;
ALTER TABLE quotes_quote DROP CONSTRAINT qg_status;
DROP TRIGGER qg_cost_guard ON quotes_costitem;
DROP FUNCTION qg_cost_guard();
DROP TRIGGER qg_finalised_guard ON quotes_quote;
DROP FUNCTION qg_finalised_guard();
"""


class Migration(migrations.Migration):
    dependencies = [("quotes", "0001_initial")]
    operations = [migrations.RunSQL(SQL, REVERSE)]
