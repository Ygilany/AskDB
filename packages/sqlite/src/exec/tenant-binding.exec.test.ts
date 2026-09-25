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

async function openMemoryDb(): Promise<Db | undefined> {
  try {
    const mod = (await import("better-sqlite3")) as unknown as Bs3Namespace;
    return new mod.default(":memory:");
  } catch {
    return undefined;
  }
}

const here = dirname(fileURLToPath(import.meta.url));
const schema = loadSchema(join(here, "../../../../fixtures/schemas/agency-multi-tenant.schema"));
const fakeModel = {} as Parameters<typeof ask>[0]["model"];

const probe = await openMemoryDb();
probe?.close();
// Under ASKDB_REQUIRE_INTEGRATION=1 a driver that fails to load fails the suite instead of skipping.
const suite = integrationSuite({
  unavailable: probe ? null : "better-sqlite3 could not be loaded",
});

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
    db = (await openMemoryDb())!;
    db.exec(`
      CREATE TABLE orders (agency_id TEXT, status TEXT, total INTEGER, note TEXT);
      INSERT INTO orders VALUES
        ('42', 'paid', 20, 'a'),
        ('42', 'paid',  5, 'b'),
        ('42', 'open', 99, 'c'),
        ('99', 'paid', 30, 'd'),
        ('7',  'paid', 50, 'e'),
        ('7',  'paid', 70, ':tenant_agency_ids');
    `);
  });

  afterAll(() => db?.close());

  const count = (sql: string, params: readonly unknown[] = []): number => {
    const prepared = toSqlite(sql, params);
    return (db.prepare(prepared.sql).get(...prepared.args) as { n: number }).n;
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
      const result = await ask({
        question: "orders",
        schema,
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
});
