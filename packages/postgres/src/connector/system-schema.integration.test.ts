/**
 * Live-database check that a user schema whose name only matches the system
 * schema patterns through the `_` wildcard (`pgxtoast` vs `pg_toast%`) is kept,
 * while the real system schemas stay excluded.
 *
 * Needs `DATABASE_URL`: skipped without it, failed under ASKDB_REQUIRE_INTEGRATION=1.
 * Creates and drops its own schema.
 */
import { introspect } from "@askdb/introspect";
import { afterAll, beforeAll, expect, it } from "vitest";
import { integrationSuite } from "../../../../scripts/test-utils/integration.mjs";
import { createPostgresCatalogQueryRunner } from "../exec/postgres.js";
import { createPostgresConnector } from "./index.js";

const url = process.env.DATABASE_URL;
const suite = integrationSuite({ env: ["DATABASE_URL"] });
const schemaName = "pgxtoast";

async function exec(sql: string): Promise<void> {
  const mod = await import("pg");
  // `pg` is CJS — the ESM namespace puts the module under `.default` at runtime.
  const pg = (mod as unknown as { default?: typeof mod }).default ?? mod;
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

suite("system-schema matching (live Postgres)", () => {
  beforeAll(async () => {
    await exec(`
      CREATE SCHEMA IF NOT EXISTS ${schemaName};
      CREATE TABLE ${schemaName}.t (id int PRIMARY KEY);
    `);
  });

  afterAll(async () => {
    await exec(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE;`);
  });

  it("keeps a user schema named like a system schema and drops the real ones", async () => {
    const { schema } = await introspect(
      { mode: "live" as const, runner: createPostgresCatalogQueryRunner(url!) },
      undefined,
      { connector: createPostgresConnector() },
    );
    const names = schema.schemas.map((ns) => ns.name);
    expect(names).toContain(schemaName);
    for (const system of ["information_schema", "pg_catalog", "pg_toast"]) {
      expect(names).not.toContain(system);
    }
  });
});
