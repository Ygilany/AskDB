/**
 * Executes the SQL + params that `ask()` returns for tenant-scoped queries
 * against a real SQLite database, for every built-in marker style.
 *
 * `$N` (Postgres) and `@pN` (SQL Server) markers are rewritten to named SQLite
 * parameters bound to the matching array slot — so the check is exactly
 * "marker N reads params[N-1]" — and `?` (MySQL / SQLite) runs as-is, which
 * checks that positional order matches source order.
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type DatabaseCtor from "better-sqlite3";
import { ask, loadSchema, type TenantScope } from "@askdb/core";
import { integrationSuite } from "../../../../scripts/test-utils/integration.mjs";

type Bs3Namespace = { default: typeof DatabaseCtor };
type Db = InstanceType<typeof DatabaseCtor>;

async function openMemoryDb(): Promise<Db> {
  const mod = (await import("better-sqlite3")) as unknown as Bs3Namespace;
  return new mod.default(":memory:");
}

/** Returns why better-sqlite3 cannot be used here, or `null` when it loads and opens a DB. */
async function betterSqlite3Unavailable(): Promise<string | null> {
  try {
    (await openMemoryDb()).close();
    return null;
  } catch (err) {
    return `better-sqlite3 could not be loaded (${err instanceof Error ? err.message : String(err)})`;
  }
}

const here = dirname(fileURLToPath(import.meta.url));
const schema = loadSchema(join(here, "../../../../fixtures/schemas/agency-multi-tenant.schema"));
const fakeModel = {} as Parameters<typeof ask>[0]["model"];

// Under ASKDB_REQUIRE_INTEGRATION=1 a driver that fails to load fails the suite instead of skipping.
const suite = integrationSuite({ unavailable: await betterSqlite3Unavailable() });

/**
 * Prepare `sql` + positional `params` for better-sqlite3. Numbered markers
 * (outside string literals) become named `@vN`, bound to `params[N-1]`, so the
 * run checks exactly "marker N reads params[N-1]"; `?` stays positional.
 */
function toSqlite(sql: string, params: readonly unknown[]): { sql: string; args: unknown[] } {
  let numbered = false;
  const out = sql.replace(/'(?:[^']|'')*'|\$(\d+)|@p(\d+)/g, (m, dollar?: string, atp?: string) => {
    if (dollar === undefined && atp === undefined) return m;
    numbered = true;
    return `@v${dollar !== undefined ? Number(dollar) : Number(atp) + 1}`;
  });
  if (!numbered) return { sql: out, args: [...params] };
  return { sql: out, args: [Object.fromEntries(params.map((v, i) => [`v${i + 1}`, v]))] };
}

const reply = (sql: string, unbound?: string, manifest?: string) => async () => ({
  text: [
    "```sql",
    sql,
    "```",
    ...(unbound ? ["```sql-unbound", unbound, "```"] : []),
    ...(manifest ? ["```json", manifest, "```"] : []),
  ].join("\n"),
});

suite("tenant parameter binding executes on SQLite (better-sqlite3)", () => {
  let db: Db;

  beforeAll(async () => {
    db = await openMemoryDb();
    db.exec(`
      CREATE TABLE orders (agency_id TEXT, status TEXT, total INTEGER, note TEXT);
      INSERT INTO orders VALUES
        ('42', 'paid', 20, 'a'),
        ('42', 'paid',  5, 'b'),
        ('42', 'open', 99, 'c'),
        ('99', 'paid', 30, 'd'),
        ('7',  'paid', 50, 'e'),
        ('7',  'paid', 70, ':tenant_agency_ids'),
        ('1',  'open',  1, 'X order'),
        ('5',  'open',  1, 'Y order');

      -- Two tenants whose descendant IDs collide across root tables (#338): tenant X is
      -- agency 1, which owns sub-agency 5 and client 5; tenant Y is agency 5.
      CREATE TABLE agencies (id TEXT);
      INSERT INTO agencies VALUES ('1'), ('5');
      CREATE TABLE sub_agencies (id TEXT, agency_id TEXT);
      INSERT INTO sub_agencies VALUES ('5', '1'), ('9', '5');
      CREATE TABLE clients (id TEXT, sub_agency_id TEXT);
      INSERT INTO clients VALUES ('5', '5'), ('1', '9');
      CREATE TABLE appointments (client_id TEXT, label TEXT);
      INSERT INTO appointments VALUES ('5', 'X appt'), ('1', 'Y appt');
      CREATE TABLE notes (owner_type TEXT, owner_id TEXT, label TEXT);
      INSERT INTO notes VALUES
        ('agency', '1', 'X agency note'), ('agency', '5', 'Y agency note'),
        ('client', '5', 'X client note'), ('client', '1', 'Y client note');
    `);
  });

  afterAll(() => db?.close());

  const count = (sql: string, params: readonly unknown[] = []): number => {
    const prepared = toSqlite(sql, params);
    return (db.prepare(prepared.sql).get(...prepared.args) as { n: number }).n;
  };

  const labels = (sql: string, params: readonly unknown[] = []): string[] => {
    const prepared = toSqlite(sql, params);
    return (db.prepare(prepared.sql).all(...prepared.args) as { label: string }[]).map((r) => r.label);
  };

  const twoAgencies: TenantScope = {
    access: { kind: "ids", tenantRoot: "table:public.agencies", ids: ["42", "99"] },
  };

  // Tenant list first, business values after it: `?` dialects must interleave.
  const scopedCount = reply(
    "SELECT count(*) AS n FROM orders WHERE agency_id IN (:tenant_agency_ids) AND status = 'paid' AND total > 10",
    "SELECT count(*) AS n FROM orders WHERE agency_id IN (:tenant_agency_ids) AND status = :status_name AND total > :min_total",
    '{"parameters":[{"name":"status_name","type":"string","cardinality":"one","value":"paid"},' +
      '{"name":"min_total","type":"number","cardinality":"one","value":10}]}',
  );

  it.each(["postgres", "mysql", "sqlite", "sqlserver"] as const)(
    "%s output: sql + tenantParams and unboundSql + params both return the scoped rows",
    async (dialect) => {
      const result = await ask({
        question: "paid orders over 10",
        schema,
        model: fakeModel,
        dialect,
        tenantScope: twoAgencies,
        tenantSqlMode: "sql-params",
        deps: { generateText: scopedCount as never },
      });
      expect(result.unboundSql).toBeDefined();
      expect(count(result.sql, result.tenantParams)).toBe(2);
      expect(count(result.unboundSql!, result.params)).toBe(2);

      const literal = await ask({
        question: "paid orders over 10",
        schema,
        model: fakeModel,
        dialect,
        tenantScope: twoAgencies,
        tenantSqlMode: "sql-only",
        deps: { generateText: scopedCount as never },
      });
      expect(count(literal.sql)).toBe(2);
      expect(count(literal.unboundSql!, literal.params)).toBe(2);
    },
  );

  it.each(["sql-only", "sql-params"] as const)(
    "%s: a crafted tenant ID cannot widen the query, and quoted placeholder text is not substituted",
    async (tenantSqlMode) => {
      // The reply ORs the tenant predicate on purpose, to show what the crafted ID and the
      // quoted placeholder text bind to. The strict guardrail rejects that shape (#315),
      // so this runs the policy in warn mode: it's about binding, not the guardrail.
      const warnSchema = { ...schema, tenantPolicy: { ...schema.tenantPolicy!, enforcement: "warn" as const } };
      const result = await ask({
        question: "orders",
        schema: warnSchema,
        model: fakeModel,
        dialect: "sqlite",
        tenantScope: {
          access: { kind: "ids", tenantRoot: "table:public.agencies", ids: ["x') OR 1=1 --"] },
        },
        tenantSqlMode,
        parameterize: false,
        deps: {
          generateText: reply(
            "SELECT count(*) AS n FROM orders WHERE agency_id IN (:tenant_agency_ids) OR note = ':tenant_agency_ids'",
          ) as never,
        },
      });
      // Only the row whose note literally reads ':tenant_agency_ids' matches.
      expect(count(result.sql, result.tenantParams ?? [])).toBe(1);
    },
  );

  // Regression (#338): a subtree whose descendant IDs collide with another tenant's IDs.
  // Binding sub-agency 5 or client 5 as an agency ID returned tenant Y's rows. The host
  // resolver walks the hierarchy on the database and returns each level's IDs under that
  // level's root; each query must return exactly tenant X's rows.
  it.each(["sql-only", "sql-params"] as const)(
    "%s: a subtree with IDs colliding across root tables returns only its own tenant's rows",
    async (tenantSqlMode) => {
      const idsWhere = (table: string, fk: string, parents: readonly string[]): string[] =>
        parents.length === 0
          ? []
          : (db.prepare(`SELECT id FROM ${table} WHERE ${fk} IN (${parents.map(() => "?").join(", ")})`).pluck().all(...parents) as string[]);
      const resolveTenantDescendants = (tenantRoot: string, seedIds: readonly string[]) => {
        const subAgencies = idsWhere("sub_agencies", "agency_id", seedIds);
        return {
          [tenantRoot]: [...seedIds],
          "table:public.sub_agencies": subAgencies,
          "table:public.clients": idsWhere("clients", "sub_agency_id", subAgencies),
        };
      };
      const cases = [
        { sql: "SELECT note AS label FROM orders WHERE agency_id = :tenant_agency_ids", rows: ["X order"] },
        {
          sql: "SELECT label FROM notes WHERE owner_type = 'agency' AND owner_id IN (:tenant_agency_ids)",
          rows: ["X agency note"],
        },
        {
          sql:
            "SELECT a.label FROM appointments a JOIN clients c ON a.client_id = c.id " +
            "JOIN sub_agencies s ON c.sub_agency_id = s.id WHERE s.agency_id IN (:tenant_agency_ids) " +
            "AND s.id IN (:tenant_sub_agency_ids) AND c.id IN (:tenant_client_ids)",
          rows: ["X appt"],
        },
        { sql: "SELECT a.label FROM appointments a JOIN clients c ON a.client_id = c.id WHERE c.id IN (:tenant_client_ids)", rows: ["X appt"] },
        {
          sql: "SELECT label FROM notes WHERE owner_type = 'client' AND owner_id IN (:tenant_client_ids)",
          rows: ["X client note"],
        },
      ];

      for (const c of cases) {
        const result = await ask({
          question: "tenant X's rows",
          schema,
          model: fakeModel,
          dialect: "sqlite",
          tenantScope: {
            access: { kind: "subtree", tenantRoot: "table:public.agencies", rootIds: ["1"], includeDescendants: true },
          },
          resolveTenantDescendants,
          tenantSqlMode,
          parameterize: false,
          deps: { generateText: reply(c.sql) as never },
        });
        expect(labels(result.sql, result.tenantParams ?? []), c.sql).toEqual(c.rows);
      }
    },
  );
});
