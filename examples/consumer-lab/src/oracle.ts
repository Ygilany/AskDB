/**
 * The expected answer to every catalog question, computed in TypeScript from the fixture's
 * seed data (`fixtures/multi-engine/dataset/data/*.json`), never by running SQL: not the
 * cassette's, and not any other. Each answer declares its columns' logical types and
 * whether its row order is part of the answer, which is how `normalizeRows` compares it
 * with what an engine returned (`dataset/NORMALIZATION.md`).
 *
 * Plain data and Node built-ins only: the oracle never imports AskDB.
 */
import { loadRows, type LogicalType } from "./fixture.js";

export interface Oracle {
  /** Each result column's logical type, by position. */
  types: LogicalType[];
  /** The rows must come back in this order (the question asks for an order). Otherwise a multiset. */
  ordered?: boolean;
  rows(): unknown[][];
}

type Row = Record<string, string | number | boolean | null>;

const table = (schema: string, name: string): Row[] => loadRows({ schema, name });
const agencies = () => table("org", "agency");
const programs = () => table("org", "program");
const clients = () => table("people", "client");
const enrollments = () => table("people", "enrollment");
const orders = () => table("billing", "order");
const payments = () => table("billing", "payment");

/** `"118.05"` → 11805n. Every decimal in the dataset has two places. */
function cents(value: unknown): bigint {
  const match = /^(-?)(\d+)\.(\d{2})$/.exec(String(value));
  if (!match) throw new Error(`oracle: not a two-place decimal: ${JSON.stringify(value)}`);
  const magnitude = BigInt(match[2]!) * 100n + BigInt(match[3]!);
  return match[1] ? -magnitude : magnitude;
}

function fromCents(value: bigint): string {
  const sign = value < 0n ? "-" : "";
  const abs = value < 0n ? -value : value;
  return `${sign}${abs / 100n}.${String(abs % 100n).padStart(2, "0")}`;
}

/** Group rows by a key and fold each group. Key order is first appearance. */
function groupBy<K, V>(rows: Row[], key: (r: Row) => K, fold: (group: Row[]) => V): [K, V][] {
  const groups = new Map<K, Row[]>();
  for (const r of rows) groups.set(key(r), [...(groups.get(key(r)) ?? []), r]);
  return [...groups].map(([k, group]) => [k, fold(group)]);
}

/** Programs that started on or after an ISO date (ISO dates compare as strings). */
export function programsStartedOnOrAfter(date: string): unknown[][] {
  return programs()
    .filter((p) => String(p.starts_on) >= date)
    .map((p) => [p.agency_id, p.program_code]);
}

/** The value `programs-started-since` asks about, as its question text writes it. */
export const PROGRAMS_SINCE = "2022-01-01";

export const ORACLES: Record<string, Oracle> = {
  "agency-names": {
    types: ["int", "text"],
    ordered: true,
    rows: () => agencies()
      .sort((a, b) => Number(a.agency_id) - Number(b.agency_id))
      .map((a) => [a.agency_id, a.name]),
  },
  "active-programs-per-agency": {
    types: ["int", "bigint"],
    rows: () => groupBy(programs().filter((p) => p.is_active === true), (p) => p.agency_id, (g) => g.length),
  },
  "unpaid-orders": {
    types: ["int", "decimal"],
    rows: () => orders()
      .filter((o) => o.is_paid === false)
      .map((o) => [o.order_id, o.total]),
  },
  "top-paid-agencies": {
    // billing.agency_revenue: per agency with orders, SUM(total) over its paid orders, 0 when none is.
    types: ["int", "decimal"],
    ordered: true,
    rows: () => groupBy(orders(), (o) => o.agency_id, (g) => g.filter((o) => o.is_paid === true).reduce((sum, o) => sum + cents(o.total), 0n))
      .sort(([a, x], [b, y]) => (x === y ? Number(a) - Number(b) : y > x ? 1 : -1))
      .slice(0, 3)
      .map(([agency, paid]) => [agency, fromCents(paid)]),
  },
  "client-agency-names": {
    types: ["int", "text", "text"],
    rows: () => {
      const names = new Map(agencies().map((a) => [a.agency_id, a.name]));
      return clients().map((c) => [c.client_id, c.full_name, names.get(c.agency_id)]);
    },
  },
  "enrollment-program-names": {
    // The composite key: a program code alone names a different program at each agency.
    types: ["int", "text", "text"],
    rows: () => {
      const names = new Map(programs().map((p) => [`${p.agency_id}/${p.program_code}`, p.name]));
      return enrollments().map((e) => [e.client_id, e.program_code, names.get(`${e.agency_id}/${e.program_code}`)]);
    },
  },
  "payments-per-agency": {
    types: ["int", "decimal"],
    rows: () => groupBy(payments(), (p) => p.agency_id, (g) => fromCents(g.reduce((sum, p) => sum + cents(p.amount), 0n))),
  },
  "orders-q1-2024": {
    // Timestamps are naive `YYYY-MM-DDTHH:MM:SS`, so they compare as strings.
    types: ["int", "timestamp"],
    rows: () => orders()
      .filter((o) => String(o.placed_at) >= "2024-01-01T00:00:00" && String(o.placed_at) < "2024-04-01T00:00:00")
      .map((o) => [o.order_id, o.placed_at]),
  },
  "program-active-flags": {
    types: ["int", "text", "boolean"],
    rows: () => programs().map((p) => [p.agency_id, p.program_code, p.is_active]),
  },
  "open-enrollments": {
    types: ["int", "text"],
    rows: () => enrollments()
      .filter((e) => e.exited_on === null)
      .map((e) => [e.client_id, e.program_code]),
  },
  "client-named-sato": {
    types: ["int", "date"],
    rows: () => clients()
      .filter((c) => c.full_name === "佐藤 花子")
      .map((c) => [c.client_id, c.birth_date]),
  },
  "top-five-orders": {
    types: ["int", "decimal"],
    ordered: true,
    rows: () => orders()
      .sort((a, b) => {
        const [x, y] = [cents(a.total), cents(b.total)];
        return x === y ? Number(a.order_id) - Number(b.order_id) : y > x ? 1 : -1;
      })
      .slice(0, 5)
      .map((o) => [o.order_id, o.total]),
  },
  "agency-parent-names": {
    // Roots have no parent: their second column is NULL.
    types: ["int", "text"],
    rows: () => {
      const names = new Map(agencies().map((a) => [a.agency_id, a.name]));
      return agencies().map((a) => [a.agency_id, a.parent_agency_id === null ? null : names.get(a.parent_agency_id)]);
    },
  },
  "distinct-enrolled-clients": {
    types: ["int", "bigint"],
    rows: () => groupBy(enrollments(), (e) => e.agency_id, (g) => new Set(g.map((e) => e.client_id)).size),
  },
  "programs-started-since": {
    types: ["int", "text"],
    rows: () => programsStartedOnOrAfter(PROGRAMS_SINCE),
  },
};
