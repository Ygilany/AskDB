import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import {
  parseTableMarkdown,
  type V2SchemaJson,
  type V2Table,
  type V2Column,
} from "@askdb/core";
import type {
  IntrospectionWarning,
  SqlColumn,
  SqlForeignKey,
  SqlSchema,
  SqlTable,
} from "../types.js";
import type { RenderOptions, RenderResult } from "./types.js";

/**
 * Render a `SqlSchema` to a Schema v2 directory.
 *
 * Clean writes and ID-anchored re-introspection merges write `schema.json`
 * only. The describable layer (`tables/*.md`, `concepts.md`) is read only for
 * orphan detection when `existingArtifactDir` is supplied.
 *
 * Determinism contract (requirements.md §5):
 *   - Schemas alphabetical at the source (the connector already produces
 *     this); tables alphabetical by `(schema, name)` in the emitted v2 file.
 *   - Columns in `ordinalPosition` order.
 *   - FKs sorted by constraint name; `relationships[]` derived in the same
 *     order so the file is byte-identical across runs.
 *
 * Output format: `JSON.stringify(value, null, 2) + "\n"` (matches the
 * hand-authored Phase 5 fixtures).
 */
export function renderToSchemaV2(
  schema: SqlSchema,
  options: RenderOptions,
): RenderResult {
  const warnings: IntrospectionWarning[] = [];
  const fresh = toV2SchemaJson(schema, options.schemaId, options.provider);
  const v2 = options.existingArtifactDir
    ? mergeWithExistingArtifact(fresh, options.existingArtifactDir, warnings)
    : fresh;

  mkdirSync(options.outDir, { recursive: true });
  const schemaJsonPath = resolve(options.outDir, "schema.json");
  const body = JSON.stringify(v2, null, 2) + "\n";
  writeFileSync(schemaJsonPath, body, "utf8");

  return { schemaJsonPath, warnings };
}

function mergeWithExistingArtifact(
  fresh: V2SchemaJson,
  existingArtifactDir: string,
  warnings: IntrospectionWarning[],
): V2SchemaJson {
  const existing = readExistingPhysical(existingArtifactDir);
  const existingTables = new Map(existing.tables.map((table) => [table.id, table]));
  const existingColumns = new Map<string, V2Column>();

  for (const table of existing.tables) {
    for (const column of table.columns) {
      existingColumns.set(column.id, column);
    }
  }

  for (const table of fresh.tables) {
    const existingTable = existingTables.get(table.id);
    if (existingTable?.sensitive !== undefined) {
      table.sensitive = existingTable.sensitive;
    }

    for (const column of table.columns) {
      const existingColumn = existingColumns.get(column.id);
      if (existingColumn) {
        if (existingColumn.sensitive !== undefined) {
          column.sensitive = existingColumn.sensitive;
        }
      } else {
        warnings.push({ code: "new_column", id: column.id, tableId: table.id });
      }
    }
  }

  warnings.push(...findOrphanWarnings(existingArtifactDir, fresh));
  return fresh;
}

function readExistingPhysical(existingArtifactDir: string): V2SchemaJson {
  const schemaJsonPath = resolve(existingArtifactDir, "schema.json");
  const parsed: unknown = JSON.parse(readFileSync(schemaJsonPath, "utf8"));
  return assertV2SchemaJson(parsed, schemaJsonPath);
}

function assertV2SchemaJson(value: unknown, filePath: string): V2SchemaJson {
  if (!isRecord(value) || value.version !== 2) {
    throw new Error(`@askdb/introspect: invalid Schema v2 file at ${filePath}`);
  }
  if (typeof value.schemaId !== "string" || !Array.isArray(value.tables)) {
    throw new Error(`@askdb/introspect: invalid Schema v2 file at ${filePath}`);
  }
  for (const table of value.tables) {
    if (
      !isRecord(table) ||
      typeof table.id !== "string" ||
      typeof table.name !== "string" ||
      typeof table.schema !== "string" ||
      !Array.isArray(table.columns)
    ) {
      throw new Error(`@askdb/introspect: invalid Schema v2 table in ${filePath}`);
    }
    for (const column of table.columns) {
      if (
        !isRecord(column) ||
        typeof column.id !== "string" ||
        typeof column.name !== "string" ||
        typeof column.type !== "string" ||
        typeof column.nullable !== "boolean"
      ) {
        throw new Error(
          `@askdb/introspect: invalid Schema v2 column in ${filePath}`,
        );
      }
    }
  }
  return value as V2SchemaJson;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function findOrphanWarnings(
  existingArtifactDir: string,
  fresh: V2SchemaJson,
): IntrospectionWarning[] {
  const tableIds = new Set(fresh.tables.map((table) => table.id));
  const columnIds = new Set(
    fresh.tables.flatMap((table) => table.columns.map((column) => column.id)),
  );
  const tableDir = join(existingArtifactDir, "tables");
  if (!existsSync(tableDir)) return [];

  const warnings: IntrospectionWarning[] = [];
  const seen = new Set<string>();
  for (const entry of readdirSync(tableDir)) {
    if (!entry.endsWith(".md")) continue;
    const filePath = join(tableDir, entry);
    const relativeFile = `tables/${entry}`;
    const parsed = parseTableMarkdown(readFileSync(filePath, "utf8"), filePath);

    appendOrphanWarning(parsed.frontmatter.id, relativeFile, tableIds, warnings, seen);
    for (const column of parsed.frontmatter.columns ?? []) {
      appendOrphanWarning(column.id, relativeFile, columnIds, warnings, seen);
    }
  }
  return warnings;
}

function appendOrphanWarning(
  id: string,
  file: string,
  validIds: Set<string>,
  warnings: IntrospectionWarning[],
  seen: Set<string>,
): void {
  const key = `${file}\0${id}`;
  if (validIds.has(id) || seen.has(key)) return;
  seen.add(key);
  warnings.push({ code: "orphan_id", id, file });
}

/**
 * Pure-function form of {@link renderToSchemaV2} — exposed so callers (and
 * M6's merge) can produce the V2 JSON without writing it to disk.
 *
 * Pass `provider` (e.g. `"postgres"`, `"mysql"`) to persist the detected
 * dialect so hosts can auto-select it at `ask` time.
 */
export function toV2SchemaJson(
  schema: SqlSchema,
  schemaId: string,
  provider?: string,
): V2SchemaJson {
  const tables: V2Table[] = [];

  for (const ns of schema.schemas) {
    for (const t of ns.tables) {
      tables.push(toV2Table(t));
    }
  }

  tables.sort((a, b) => {
    const aSchema = a.schema;
    const bSchema = b.schema;
    if (aSchema !== bSchema) return aSchema.localeCompare(bSchema);
    return a.name.localeCompare(b.name);
  });

  return {
    version: 2,
    schemaId,
    ...(provider ? { provider } : {}),
    tables,
  };
}

function toV2Table(table: SqlTable): V2Table {
  const columns = table.columns
    .slice()
    .sort((a, b) => a.ordinalPosition - b.ordinalPosition)
    .map(toV2Column);

  const v2Table: V2Table = {
    id: table.id,
    name: table.name,
    schema: table.schema,
    sensitive: false,
    columns,
  };

  const relationships = buildRelationships(table);
  if (relationships.length > 0) {
    v2Table.relationships = relationships;
  }

  return v2Table;
}

function toV2Column(column: SqlColumn): V2Column {
  // Field order matches the Phase 5 hand-authored fixtures:
  //   id, name, type, nullable, [primaryKey], sensitive.
  return {
    id: column.id,
    name: column.name,
    type: compactPostgresType(column.dataType, column.udtName),
    nullable: column.nullable,
    ...(column.primaryKey ? { primaryKey: true } : {}),
    sensitive: false,
  };
}

function buildRelationships(
  table: SqlTable,
): NonNullable<V2Table["relationships"]> {
  const out: NonNullable<V2Table["relationships"]> = [];
  // FKs are already sorted by constraint name in the connector — preserve.
  for (const fk of table.foreignKeys) {
    appendFkRelationships(out, table, fk);
  }
  return out;
}

function appendFkRelationships(
  acc: NonNullable<V2Table["relationships"]>,
  table: SqlTable,
  fk: SqlForeignKey,
): void {
  const local = fk.columns;
  const referenced = fk.references.columns;
  // The connector guarantees both lists have equal length and the same
  // declared (conkey/confkey) order — emit one relationship per pair.
  const len = Math.min(local.length, referenced.length);
  for (let i = 0; i < len; i++) {
    acc.push({
      from: `${table.id}#${local[i]}`,
      to: `table:${fk.references.schema}.${fk.references.table}#${referenced[i]}`,
    });
  }
}

/**
 * Map Postgres `format_type` strings to the short names AskDB Schema v2
 * uses in its hand-authored fixtures. Only the standard SQL ↔ pg-short-name
 * aliases are touched; unknown strings (and length/precision modifiers)
 * pass through unchanged.
 */
export function compactPostgresType(
  dataType: string,
  _udtName: string,
): string {
  if (dataType === "timestamp with time zone") return "timestamptz";
  if (dataType === "time with time zone") return "timetz";
  if (dataType === "timestamp without time zone") return "timestamp";
  if (dataType === "time without time zone") return "time";
  if (dataType.startsWith("character varying")) {
    return dataType.replace("character varying", "varchar");
  }
  if (dataType === "character") return "char";
  if (dataType.startsWith("character(")) {
    return dataType.replace("character(", "char(");
  }
  return dataType;
}
