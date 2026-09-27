/**
 * Dataset equivalence: every fixture database holds exactly the canonical dataset.
 *
 * Protects: the fixture's founding invariant. Package introspection tests and the
 * consumer lab compare engines against one golden schema and one set of rows, so
 * the five engines must hold the same logical data, and hosts rely on the
 * read-only role being unable to write.
 * Catches: DDL or seeder drift in one engine, e.g. unicode lost to a non-utf8mb4
 * charset, a timestamp shifted by a driver's local-timezone conversion, a decimal
 * truncated by a narrower column, a boolean stored as the wrong value, a view whose
 * per-engine SQL disagrees, or a grant that leaves `fixture_reader` writable.
 * Not covered elsewhere: nothing else loads one dataset into several engines.
 * No production seam: reads through the engine drivers only; AskDB is not involved.
 *
 * Needs the seeded fixture (`pnpm fixture:up`) and ASKDB_FIXTURE_HOST; skipped
 * without it, and failing instead when ASKDB_REQUIRE_INTEGRATION=1.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { integrationSuite } from "../../../scripts/test-utils/integration.mjs";
import { loadLogicalSchema, loadRows, logicalTypeOf, physicalName, quoteIdent } from "../src/dataset.js";
import { openDb, type FixtureDb } from "../src/db.js";
import { normalizeRows, type LogicalType } from "../src/normalize.js";
import { DIALECTS, FIXTURE_HOST_ENV, type Dialect } from "../src/env.js";

const schema = loadLogicalSchema();
const fixtureSuite = integrationSuite({ env: [FIXTURE_HOST_ENV] });

/** Independent oracle for billing.agency_revenue, computed from the canonical JSON. */
function expectedAgencyRevenue(): unknown[][] {
  const byAgency = new Map<number, { count: number; paidCents: bigint }>();
  for (const order of loadRows({ schema: "billing", name: "order" })) {
    const entry = byAgency.get(order.agency_id as number) ?? { count: 0, paidCents: 0n };
    entry.count += 1;
    if (order.is_paid) entry.paidCents += BigInt(String(order.total).replace(".", ""));
    byAgency.set(order.agency_id as number, entry);
  }
  return [...byAgency].map(([agencyId, { count, paidCents }]) => [
    agencyId,
    count,
    `${paidCents / 100n}.${String(paidCents % 100n).padStart(2, "0")}`,
  ]);
}

/** A write the owner could perform; the reader must be refused. */
function writeProbe(dialect: Dialect): string {
  const status = physicalName(dialect, { schema: "ref", name: "status" });
  return `INSERT INTO ${status} (${quoteIdent(dialect, "status_code")}, ${quoteIdent(dialect, "label")}) VALUES ('LAB_PROBE', 'probe')`;
}

fixtureSuite("multi-engine fixture", () => {
  describe.each(DIALECTS)("[%s] dataset", (dialect) => {
    let db: FixtureDb;

    beforeAll(async () => {
      db = await openDb(dialect, "reader");
    });
    afterAll(async () => {
      await db?.close();
    });

    it.each(schema.tables.map((t) => [`${t.schema}.${t.name}`, t] as const))("%s rows equal the canonical JSON", async (_, table) => {
      const types = table.columns.map((c) => logicalTypeOf(c.type));
      const columnList = table.columns.map((c) => quoteIdent(dialect, c.name)).join(", ");
      const rows = await db.query(`SELECT ${columnList} FROM ${physicalName(dialect, table)}`);

      const actual = normalizeRows(rows.map((r) => table.columns.map((c) => r[c.name])), types);
      const expected = normalizeRows(loadRows(table).map((r) => table.columns.map((c) => r[c.name] ?? null)), types);
      expect(actual).toEqual(expected);
    });

    it("billing.agency_revenue view matches the oracle", async () => {
      const view = { schema: "billing", name: "agency_revenue" };
      const types: LogicalType[] = ["int", "bigint", "decimal"];
      const rows = await db.query(`SELECT agency_id, order_count, paid_total FROM ${physicalName(dialect, view)}`);

      const actual = normalizeRows(rows.map((r) => [r.agency_id, r.order_count, r.paid_total]), types);
      expect(actual).toEqual(normalizeRows(expectedAgencyRevenue(), types));
    });

    it("fixture_reader cannot write", async () => {
      await expect(db.query(writeProbe(dialect))).rejects.toThrow(/read-only|readonly|denied|permission/i);
    });
  });
});
