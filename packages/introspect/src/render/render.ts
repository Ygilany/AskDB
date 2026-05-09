import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { V2SchemaJson, V2Table, V2Column } from "@askdb/core";
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
 * M3 ships the **clean-write** path — no merge against an existing artifact.
 * Passing `existingArtifactDir` is a hard error until M6 lands the
 * ID-anchored merge.
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
  if (options.existingArtifactDir !== undefined) {
    throw new Error(
      "@askdb/introspect: renderToSchemaV2() does not support existingArtifactDir yet. " +
        "ID-anchored merge lands in milestone 6 of phase 6 (see docs/specs/phase-6-introspection/plan.md).",
    );
  }

  const warnings: IntrospectionWarning[] = [];
  const v2 = toV2SchemaJson(schema, options.schemaId);

  mkdirSync(options.outDir, { recursive: true });
  const schemaJsonPath = resolve(options.outDir, "schema.json");
  const body = JSON.stringify(v2, null, 2) + "\n";
  writeFileSync(schemaJsonPath, body, "utf8");

  return { schemaJsonPath, warnings };
}

/**
 * Pure-function form of {@link renderToSchemaV2} — exposed so callers (and
 * M6's merge) can produce the V2 JSON without writing it to disk.
 */
export function toV2SchemaJson(
  schema: SqlSchema,
  schemaId: string,
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
