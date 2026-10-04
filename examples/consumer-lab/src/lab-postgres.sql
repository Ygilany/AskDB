-- Row-level security on the consumer lab's own Postgres (compose.yml), never on the shared
-- fixture. src/lab-postgres.ts runs it as the owner, in one transaction, after the fixture's
-- seeder has created the schema and rows. Idempotent: it runs on every `postgres:up`.
--
-- This is the database-side tenancy the docs recommend next to AskDB's tenant check
-- (concepts/safety-boundaries.mdx, "Enforce tenancy in the database": "Postgres row-level
-- security (RLS) keyed on a per-request setting"; guides/multi-tenancy.mdx). The host runs
-- generated SQL as `lab_tenant` with the request's tenant in the setting `app.agency_id`, set
-- per transaction, and Postgres keeps every tenant table to that agency, whatever the SQL says.
-- Unset or empty, the setting matches no row.
--
-- The tables are the tenant policy overlay's (scenarios/overlay/tenant-policy.md): the root
-- `org.agency`, the scoped tables, `order_line` through its order, and the view, which reads its
-- tables as the caller (security_invoker) so their policies apply through it. `lab_tenant` can
-- read nothing else: no grant on the `fixture` schema, nor on `payment`'s partitions, which a
-- query through `billing.payment` doesn't need and which `payment`'s policy doesn't cover.
--
-- `fixture_reader` bypasses row-level security, so it still reads every row: it is the control
-- that shows the same SQL leaks without the policies.

-- The lab's Postgres is shared by every checkout on this machine, like the fixture, so two runs
-- may apply this at once: the second waits for the first, then finds the role.
SELECT pg_advisory_xact_lock(hashtext('askdb-lab-postgres-rls'));

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
