-- Row-level security on the consumer lab's own Postgres (compose.yml), never on the shared
-- fixture. src/lab-postgres.ts runs it as the owner, in one transaction, after the fixture's
-- seeder has created the schema and rows, under the lock that serializes concurrent runs.
-- Idempotent: it runs before every `tenant-rls` run.
--
-- This is the database-side tenancy the docs recommend next to AskDB's tenant check, set up as
-- the recipe in guides/enforce-tenancy-in-the-database.mdx does ("Postgres row-level security
-- (RLS) keyed on a per-request setting", concepts/safety-boundaries.mdx). The host runs
-- generated SQL as `lab_tenant` with the request's tenant in the setting `app.agency_id`, set
-- per transaction with SET LOCAL, and Postgres keeps every tenant table to that agency, whatever
-- the SQL says. Unset or empty, the setting matches no row. The recipe's setting holds a list of
-- IDs; the lab sets one agency per request.
--
-- The tables are the tenant policy overlay's (scenarios/overlay/tenant-policy.md): the root
-- `org.agency`, the scoped tables, `order_line` through its order, and the view, which reads its
-- tables as the caller (security_invoker) so their policies apply through it. `lab_tenant` can
-- read nothing else: no grant on the `fixture` schema, nor on `payment`'s partitions, which a
-- query through `billing.payment` doesn't need and which `payment`'s policy doesn't cover.
--
-- `fixture_reader` bypasses row-level security, so it still reads every row: it is the control
-- that shows the same SQL leaks without the policies.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lab_tenant') THEN
    CREATE ROLE lab_tenant LOGIN PASSWORD 'lab_tenant';
  END IF;
END
$$;
ALTER ROLE lab_tenant SET default_transaction_read_only = on;
ALTER ROLE fixture_reader BYPASSRLS;

GRANT CONNECT ON DATABASE askdb_fixture TO lab_tenant;
GRANT USAGE ON SCHEMA org, people, billing, ref TO lab_tenant;
GRANT SELECT ON org.agency, org.program, people.client, people.enrollment, billing."order", billing.order_line, billing.payment, billing.agency_revenue, ref.status TO lab_tenant;

ALTER TABLE org.agency ENABLE ROW LEVEL SECURITY;
ALTER TABLE org.program ENABLE ROW LEVEL SECURITY;
ALTER TABLE people.client ENABLE ROW LEVEL SECURITY;
ALTER TABLE people.enrollment ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing."order" ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing.order_line ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing.payment ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lab_tenant_agency ON org.agency;
DROP POLICY IF EXISTS lab_tenant_agency ON org.program;
DROP POLICY IF EXISTS lab_tenant_agency ON people.client;
DROP POLICY IF EXISTS lab_tenant_agency ON people.enrollment;
DROP POLICY IF EXISTS lab_tenant_agency ON billing."order";
DROP POLICY IF EXISTS lab_tenant_agency ON billing.order_line;
DROP POLICY IF EXISTS lab_tenant_agency ON billing.payment;

CREATE POLICY lab_tenant_agency ON org.agency FOR SELECT TO lab_tenant
  USING (agency_id = NULLIF(current_setting('app.agency_id', true), '')::integer);
CREATE POLICY lab_tenant_agency ON org.program FOR SELECT TO lab_tenant
  USING (agency_id = NULLIF(current_setting('app.agency_id', true), '')::integer);
CREATE POLICY lab_tenant_agency ON people.client FOR SELECT TO lab_tenant
  USING (agency_id = NULLIF(current_setting('app.agency_id', true), '')::integer);
CREATE POLICY lab_tenant_agency ON people.enrollment FOR SELECT TO lab_tenant
  USING (agency_id = NULLIF(current_setting('app.agency_id', true), '')::integer);
CREATE POLICY lab_tenant_agency ON billing."order" FOR SELECT TO lab_tenant
  USING (agency_id = NULLIF(current_setting('app.agency_id', true), '')::integer);
-- An order line belongs to its order's agency; the subquery is itself under `order`'s policy.
CREATE POLICY lab_tenant_agency ON billing.order_line FOR SELECT TO lab_tenant
  USING (EXISTS (SELECT 1 FROM billing."order" o WHERE o.order_id = order_line.order_id));
CREATE POLICY lab_tenant_agency ON billing.payment FOR SELECT TO lab_tenant
  USING (agency_id = NULLIF(current_setting('app.agency_id', true), '')::integer);

ALTER VIEW billing.agency_revenue SET (security_invoker = true);

-- The guarded SQL must not change its own tenant (guides/enforce-tenancy-in-the-database.mdx,
-- "Stop the query from changing its tenant"). By default every role can, from one statement:
-- with set_config(), or with SET LOCAL in a DO block. So neither is left to PUBLIC. The host sets
-- the tenant with SET LOCAL, which needs neither (src/lab-postgres.ts). Nothing else on this
-- server needs them as a non-superuser: the seeder and this file run as fixture_owner, a
-- superuser, and fixture_reader and lab_tenant only read. Postgres keeps these privileges per
-- database, so they stay revoked until the server is reset.
REVOKE EXECUTE ON FUNCTION pg_catalog.set_config(text, text, boolean) FROM PUBLIC;
REVOKE USAGE ON LANGUAGE plpgsql FROM PUBLIC;
