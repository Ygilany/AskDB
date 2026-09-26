/**
 * Dataset equivalence: every lab database holds exactly the canonical dataset.
 *
 * Protects: the lab's founding invariant. Every cross-dialect comparison in the
 * other suites assumes the five engines hold the same logical rows, and the
 * tenant/sensitive suites assume the read-only role cannot write.
 * Catches: DDL or seeder drift in one dialect, e.g. unicode lost to a non-utf8mb4
 * charset, a timestamp shifted by a driver's local-timezone conversion, a decimal
 * truncated by a narrower column, a boolean stored as the wrong value, a view whose
 * per-dialect SQL disagrees, or a grant that leaves `lab_reader` writable.
 * Not covered elsewhere: nothing else in the repo loads one dataset into several engines.
 * No production seam: reads through the engine drivers only; AskDB is not involved.
 *
 * Requires the lab databases (`pnpm lab:up`). It fails, rather than skips, when they
 * are down: a lab run with no databases has tested nothing.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadLogicalSchema, loadRows, logicalTypeOf, physicalName, quoteIdent } from "../src/dataset.js";
import { openDb, type LabDb } from "../src/host/db.js";
import { normalizeRows, type LogicalType } from "../src/host/normalize.js";
import { DIALECTS, type Dialect } from "../src/lab-env.js";

const schema = loadLogicalSchema();

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

describe.each(DIALECTS)("[%s] dataset", (dialect) => {
  let db: LabDb;

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

  it("lab_reader cannot write", async () => {
    await expect(db.query(writeProbe(dialect))).rejects.toThrow(/read-only|readonly|denied|permission/i);
  });
});
