/**
 * Compare an introspected Schema v2 `schema.json` with the golden logical schema
 * (dataset/schema.logical.json), after the normalization rules in
 * dataset/NORMALIZATION.md ("Schema-comparison rules"). Returns human-readable
 * differences; an empty list means the artifact matches.
 *
 * Deliberately independent of AskDB: it reads the artifact as plain JSON, so it
 * can judge any AskDB version's output.
 */
import { loadLogicalSchema, type LogicalSchema } from "./dataset.js";

/** The parts of a Schema v2 `schema.json` the comparison reads. */
export interface SchemaJson {
  tables: Array<{
    id: string;
    name: string;
    schema: string;
    columns: Array<{ id: string; name: string; type: string; nullable: boolean; primaryKey?: boolean }>;
    relationships?: Array<{ from: string; to: string }>;
  }>;
}

export interface CompareOptions {
  /**
   * Whether the artifact's namespaces must equal the logical schemas. True for
   * engines that expose them (Postgres, SQL Server, multi-database MySQL);
   * false for SQLite, whose single namespace AskDB renders as `public`.
   */
  expectNamespaces: boolean;
}

/**
 * Native type → normalized logical type: `int`, `bigint`, `decimal(p,s)`,
 * `boolean`, `date`, `timestamp` or `text` (length is not compared).
 * Returns undefined for a type the rules don't cover.
 */
export function normalizeNativeType(native: string): string | undefined {
  const t = native.trim().toLowerCase().replace(/\s+/g, " ").replace(/\s*,\s*/g, ",");
  if (/^(int|integer|int4|int\(\d+\))$/.test(t)) return "int";
  if (/^(bigint|int8|bigint\(\d+\))$/.test(t)) return "bigint";
  const dec = /^(?:numeric|decimal)\((\d+),(\d+)\)$/.exec(t);
  if (dec) return `decimal(${dec[1]},${dec[2]})`;
  if (/^(boolean|bool|tinyint\(1\)|bit)$/.test(t)) return "boolean";
  if (t === "date") return "date";
  if (/^(timestamp|timestamp without time zone|datetime|datetime2(\(\d\))?)$/.test(t)) return "timestamp";
  if (/^(text|(n?varchar|character varying|varchar2)(\(\d+\))?)$/.test(t)) return "text";
  return undefined;
}

/** Logical type → the normalized form it must compare equal to. */
function expectedType(logical: string): string {
  const t = logical.replace(/\s+/g, "");
  return t.startsWith("text") ? "text" : t;
}

/** `table:<ns>.<table>#<col>` → `<table>#<col>`, lower-cased. */
function columnKey(id: string): string {
  const match = /^table:[^.]+\.([^#]+)#(.+)$/.exec(id);
  return match ? `${match[1]}#${match[2]}`.toLowerCase() : id.toLowerCase();
}

export function compareToLogicalSchema(
  actual: SchemaJson,
  opts: CompareOptions,
  golden: LogicalSchema = loadLogicalSchema(),
): string[] {
  const diffs: string[] = [];
  const byName = new Map(actual.tables.map((t) => [t.name.toLowerCase(), t]));
  const expectedNames = new Set([...golden.tables, ...golden.views].map((t) => t.name.toLowerCase()));

  for (const t of actual.tables) {
    if (!expectedNames.has(t.name.toLowerCase())) diffs.push(`unexpected table ${t.schema}.${t.name}`);
  }

  for (const g of golden.tables) {
    const label = `${g.schema}.${g.name}`;
    const t = byName.get(g.name.toLowerCase());
    if (!t) {
      diffs.push(`missing table ${label}`);
      continue;
    }
    if (opts.expectNamespaces && t.schema.toLowerCase() !== g.schema) {
      diffs.push(`${label}: namespace is ${t.schema}, expected ${g.schema}`);
    }

    const names = t.columns.map((c) => c.name.toLowerCase());
    const goldenNames = g.columns.map((c) => c.name);
    if (names.join(",") !== goldenNames.join(",")) {
      diffs.push(`${label}: columns [${names.join(", ")}], expected [${goldenNames.join(", ")}]`);
    }
    for (const gc of g.columns) {
      const c = t.columns.find((x) => x.name.toLowerCase() === gc.name);
      if (!c) continue;
      const got = normalizeNativeType(c.type);
      if (got !== expectedType(gc.type)) {
        diffs.push(`${label}.${gc.name}: type ${c.type} normalizes to ${got ?? "(unmapped)"}, expected ${expectedType(gc.type)}`);
      }
      if (c.nullable !== gc.nullable) diffs.push(`${label}.${gc.name}: nullable ${c.nullable}, expected ${gc.nullable}`);
      const isPk = g.primaryKey.includes(gc.name);
      if (Boolean(c.primaryKey) !== isPk) diffs.push(`${label}.${gc.name}: primaryKey ${Boolean(c.primaryKey)}, expected ${isPk}`);
    }

    // Relationships: one {from, to} pair per FK column, composite FKs in column order.
    const rels = (t.relationships ?? []).map((r) => `${columnKey(r.from)}->${columnKey(r.to)}`);
    const expectedRels: string[][] = g.foreignKeys.map((fk) =>
      fk.columns.map((col, i) => `${g.name}#${col}->${fk.references.table}#${fk.references.columns[i]}`.toLowerCase()),
    );
    const flat = expectedRels.flat();
    const missing = flat.filter((r) => !rels.includes(r));
    const extra = rels.filter((r) => !flat.includes(r));
    if (missing.length) diffs.push(`${label}: missing relationships ${missing.join(", ")}`);
    if (extra.length) diffs.push(`${label}: unexpected relationships ${extra.join(", ")}`);
    for (const pairs of expectedRels.filter((p) => p.length > 1)) {
      const positions = pairs.map((p) => rels.indexOf(p));
      if (positions.every((p) => p >= 0) && positions.some((p, i) => i > 0 && p < positions[i - 1]!)) {
        diffs.push(`${label}: composite relationship out of column order: ${pairs.join(", ")}`);
      }
    }
  }

  // Views: Schema v2 renders them as tables. Only names and column order are compared.
  for (const v of golden.views) {
    const label = `${v.schema}.${v.name}`;
    const t = byName.get(v.name.toLowerCase());
    if (!t) {
      diffs.push(`missing view ${label}`);
      continue;
    }
    if (opts.expectNamespaces && t.schema.toLowerCase() !== v.schema) {
      diffs.push(`${label}: namespace is ${t.schema}, expected ${v.schema}`);
    }
    const names = t.columns.map((c) => c.name.toLowerCase());
    if (names.join(",") !== v.columns.join(",")) diffs.push(`${label}: columns [${names.join(", ")}], expected [${v.columns.join(", ")}]`);
  }

  return diffs;
}
