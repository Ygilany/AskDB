/**
 * The expected answers to the tenant suite's questions, for a set of visible agencies:
 * each question's answer computed in TypeScript from the fixture's seed data
 * (`fixtures/multi-engine/dataset/data/*.json`), then kept to the rows of those agencies.
 * Like `oracle.ts`, it never runs SQL and never imports AskDB.
 *
 * Which agencies a scope sees is not computed here either: `VISIBLE` is the table from
 * decision 9 in `docs/specs/consumer-lab.md`, written down, so a wrong resolver or a wrong
 * reading of the tree can't also move the expected answer.
 */
import type { LogicalType } from "./fixture.js";
import { cents, fromCents, groupBy, table } from "./oracle.js";

export interface TenantOracle {
  types: LogicalType[];
  /** The rows of the agencies in `visible`. */
  rows(visible: readonly number[]): unknown[][];
}

/** Decision 9: a scope for agency X sees X and every descendant of X, never an ancestor or another tree. */
export const VISIBLE: Record<number, readonly number[]> = {
  1: [1, 4, 5, 6],
  5: [5, 6],
  6: [6],
  7: [7],
};

/** Every agency in the fixture: an unscoped answer sees all of them. */
export const ALL_AGENCIES = [1, 2, 3, 4, 5, 6, 7] as const;

/** The date `tenant-programs-since` asks about, as its question text writes it. */
export const TENANT_PROGRAMS_SINCE = "2021-02-01";

const inScope = (visible: readonly number[]) => (row: Record<string, unknown>) => visible.includes(Number(row.agency_id));

export const TENANT_ORACLES: Record<string, TenantOracle> = {
  "tenant-programs": {
    types: ["int", "text"],
    rows: (visible) => table("org", "program").filter(inScope(visible)).map((p) => [p.agency_id, p.program_code]),
  },
  "tenant-client-agencies": {
    types: ["int", "text", "text"],
    rows: (visible) => {
      const names = new Map(table("org", "agency").map((a) => [a.agency_id, a.name]));
      return table("people", "client").filter(inScope(visible)).map((c) => [c.client_id, c.full_name, names.get(c.agency_id)]);
    },
  },
  "tenant-order-line-counts": {
    // Order lines belong to an agency through their order.
    types: ["int", "bigint"],
    rows: (visible) => {
      const scoped = new Set(table("billing", "order").filter(inScope(visible)).map((o) => o.order_id));
      return groupBy(table("billing", "order_line").filter((l) => scoped.has(l.order_id)), (l) => l.order_id, (g) => g.length);
    },
  },
  "tenant-payments-per-agency": {
    types: ["int", "decimal"],
    rows: (visible) =>
      groupBy(table("billing", "payment").filter(inScope(visible)), (p) => p.agency_id, (g) => fromCents(g.reduce((sum, p) => sum + cents(p.amount), 0n))),
  },
  "tenant-programs-since": {
    types: ["int", "text"],
    rows: (visible) =>
      table("org", "program")
        .filter(inScope(visible))
        .filter((p) => String(p.starts_on) >= TENANT_PROGRAMS_SINCE)
        .map((p) => [p.agency_id, p.program_code]),
  },
  // What the strict-mode negatives' replies select, kept to a scope.
  "tenant-program-names": {
    types: ["text", "text"],
    rows: (visible) => table("org", "program").filter(inScope(visible)).map((p) => [p.program_code, p.name]),
  },
  "tenant-agency-names": {
    types: ["text"],
    rows: (visible) => table("org", "agency").filter(inScope(visible)).map((a) => [a.name]),
  },
};
