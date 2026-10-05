/**
 * The sensitive-column overlay (`scenarios/overlay/sensitive-columns.json`) applied to the
 * fixture's schema artifacts: `people.client.email` and `people.client.ssn` marked
 * `sensitive: true` in `schema.json`, the flag `docs/contracts/sensitive-fields-and-modes.md`
 * describes (`docs/specs/consumer-lab.md`, "Sensitive columns").
 *
 * The overlay lists logical stable IDs (`table:people.client#email`). Each is found in the
 * dialect's artifact by table and column name, because SQLite renders every table under
 * `public`. The copy goes to a fresh directory: the introspected artifact itself stays
 * unmarked for the other suites, as `src/tenant.ts` does for the tenant policy.
 */
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ensureArtifact } from "./artifacts.js";
import type { SupportedDialect } from "./dialects.js";
import { loadRows } from "./fixture.js";
import { LAB_ROOT, LAB_STATE } from "./paths.js";

export const SENSITIVE_OVERLAY = join(LAB_ROOT, "scenarios", "overlay", "sensitive-columns.json");

/** A column the overlay marks sensitive, split from its logical stable ID. */
export interface SensitiveColumn {
  schema: string;
  table: string;
  column: string;
}

/** The overlay's columns: `table:<schema>.<table>#<column>`. */
export function sensitiveColumns(): SensitiveColumn[] {
  const { sensitive } = JSON.parse(readFileSync(SENSITIVE_OVERLAY, "utf8")) as { sensitive: string[] };
  return sensitive.map((id) => {
    const match = /^table:([a-z_]+)\.([a-z_]+)#([a-z_]+)$/.exec(id);
    if (!match) throw new Error(`the sensitive overlay's ${id} isn't a column ID (table:<schema>.<table>#<column>)`);
    const [, schema, table, column] = match as unknown as [string, string, string, string];
    return { schema, table, column };
  });
}

/** Each sensitive column's seeded non-null values, from its own table's seed rows. */
export function seededSensitiveValues(): { column: string; values: string[] }[] {
  return sensitiveColumns().map(({ schema, table, column }) => ({
    column,
    values: loadRows({ schema, name: table }).flatMap((row) => (row[column] == null ? [] : [String(row[column])])),
  }));
}

/** The parts of a seeded value that identify it on their own: an SSN's digits and its last four, an email's local part. */
function fragments(value: string): { contains: string[]; equals: string[] } {
  if (/^\d{3}-\d{2}-\d{4}$/.test(value)) return { contains: [value.replace(/-/g, "")], equals: [value.slice(-4)] };
  const local = /^([^@]{6,})@/.exec(value)?.[1];
  return { contains: local ? [local.toLowerCase()] : [], equals: [] };
}

/**
 * How many of each sensitive column's seeded values show up in `cells`: whole, or as a fragment
 * that identifies them (an SSN without its dashes or its last four digits, an email's local
 * part), in any case. So SQL that transforms a sensitive value (`RIGHT(ssn, 4)`, `UPPER(email)`,
 * `full_name || ' <' || email || '>'`) still counts. No seeded value elsewhere in the dataset
 * equals an SSN's last four digits, so that match is safe here.
 */
export function sensitiveValuesIn(cells: readonly unknown[]): { column: string; count: number }[] {
  const texts = cells.filter((c) => c != null).map((c) => String(c).toLowerCase());
  return seededSensitiveValues().map(({ column, values }) => ({
    column,
    count: values.filter((value) => {
      const { contains, equals } = fragments(value);
      return texts.some((t) => t.includes(value.toLowerCase()) || contains.some((f) => t.includes(f)) || equals.includes(t.trim()));
    }).length,
  }));
}

interface SchemaJsonTable {
  name: string;
  columns: { name: string; sensitive?: boolean }[];
}

/**
 * A copy of the dialect's schema artifact with the overlay's columns marked `sensitive: true`
 * in `schema.json`, in a fresh directory under `.lab/artifacts/sensitive/`. The caller
 * removes it with {@link removeSensitiveArtifact} when done; nothing else clears it.
 */
export function sensitiveArtifact(dialect: SupportedDialect): string {
  const source = ensureArtifact(dialect);
  mkdirSync(join(LAB_STATE, "artifacts", "sensitive"), { recursive: true });
  const dir = join(mkdtempSync(join(LAB_STATE, "artifacts", "sensitive", `${dialect}-`)), "schema");
  try {
    cpSync(source, dir, { recursive: true });
    const file = join(dir, "schema.json");
    const schema = JSON.parse(readFileSync(file, "utf8")) as { tables: SchemaJsonTable[] };
    for (const { table, column } of sensitiveColumns()) {
      const found = schema.tables.find((t) => t.name === table)?.columns.find((c) => c.name === column);
      if (!found) throw new Error(`the sensitive overlay names ${table}.${column}, but the ${dialect} artifact has no such column`);
      found.sensitive = true;
    }
    writeFileSync(file, JSON.stringify(schema, null, 2));
  } catch (error) {
    // Nobody gets the path to remove it, so don't leave a half-made copy behind.
    removeSensitiveArtifact(dir);
    throw error;
  }
  return dir;
}

/** Remove a copy {@link sensitiveArtifact} made (its fresh parent directory). */
export function removeSensitiveArtifact(dir: string): void {
  rmSync(dirname(dir), { recursive: true, force: true });
}
