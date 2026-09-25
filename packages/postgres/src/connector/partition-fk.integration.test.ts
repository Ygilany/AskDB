/**
 * Live-database check that FKs involving declaratively partitioned tables render
 * against the partitioned parent only (ADR 0003). PG11+ clones FKs declared on a
 * partitioned table onto every partition; PG12+ also clones FKs that *reference*
 * a partitioned table once per referenced partition. Neither kind of clone may
 * leak into the introspected foreign keys.
 *
 * Skipped unless `DATABASE_URL` is set. Creates and drops its own schema.
 */
import { randomUUID } from "node:crypto";
import { introspect } from "@askdb/introspect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPostgresCatalogQueryRunner } from "../exec/postgres.js";
import { createPostgresConnector } from "./index.js";

const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;
const schemaName = `askdb_partfk_${randomUUID().replace(/-/g, "").slice(0, 12)}`;

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

suite("foreign keys and declarative partitions (live Postgres)", () => {
  beforeAll(async () => {
    await exec(`
      CREATE SCHEMA ${schemaName};
      CREATE TABLE ${schemaName}.accounts (id int PRIMARY KEY);
      CREATE TABLE ${schemaName}.events (
        id int NOT NULL,
        region text NOT NULL,
        account_id int NOT NULL REFERENCES ${schemaName}.accounts (id),
        PRIMARY KEY (id, region)
      ) PARTITION BY LIST (region);
      CREATE TABLE ${schemaName}.events_eu PARTITION OF ${schemaName}.events FOR VALUES IN ('eu');
      CREATE TABLE ${schemaName}.events_us PARTITION OF ${schemaName}.events FOR VALUES IN ('us');
      CREATE TABLE ${schemaName}.event_notes (
        id int PRIMARY KEY,
        event_id int NOT NULL,
        event_region text NOT NULL,
        FOREIGN KEY (event_id, event_region) REFERENCES ${schemaName}.events (id, region)
      );
    `);
  });

  afterAll(async () => {
    await exec(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE;`);
  });

  it("keeps only FKs between canonical (non-leaf) tables", async () => {
    const result = await introspect(
      {
        mode: "live" as const,
        runner: createPostgresCatalogQueryRunner(url!),
        filters: { schemas: [schemaName] },
      },
      undefined,
      { connector: createPostgresConnector() },
    );
    const tables = result.schema.schemas.flatMap((ns) => ns.tables);
    expect(tables.map((t) => t.name).sort()).toEqual(["accounts", "event_notes", "events"]);

    const events = tables.find((t) => t.name === "events")!;
    expect(events.foreignKeys).toHaveLength(1);
    expect(events.foreignKeys[0]!.references).toMatchObject({ table: "accounts", columns: ["id"] });

    const notes = tables.find((t) => t.name === "event_notes")!;
    // Without the filter PG12+ yields extra constraints targeting events_eu / events_us.
    expect(notes.foreignKeys.map((fk) => fk.references.table)).toEqual(["events"]);
    expect(notes.foreignKeys[0]!.columns).toEqual(["event_id", "event_region"]);
    expect(notes.foreignKeys[0]!.references.columns).toEqual(["id", "region"]);
  });
});
