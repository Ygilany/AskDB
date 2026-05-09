import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  CheckConstraintsRow,
  ColumnsRow,
  CommentsRow,
  EnumsRow,
  ForeignKeysRow,
  IndexesRow,
  PrimaryKeysRow,
  SchemasRow,
  SequencesRow,
  TablesRow,
  UniqueConstraintsRow,
  ViewsRow,
} from "./row-types.js";
import type {
  IntrospectionFilters,
  IntrospectionResult,
  SqlTemplate,
  SqlTemplateName,
} from "../types.js";
import { compileTableFilters } from "./glob.js";
import { foldIntrospectionResult } from "./describe.js";
import {
  POSTGRES_TEMPLATE_VERSION,
  POSTGRES_TEMPLATES,
} from "./templates.js";

const DEFAULT_INCLUDE_SCHEMAS = ["public"] as const;
const SYSTEM_SCHEMA_PATTERNS = [
  "information_schema",
  "pg_catalog",
  "pg_toast",
  "pg_temp_",
  "pg_toast_temp_",
] as const;

type BundleManifest = {
  engine: "postgres";
  version: number;
  files?: Partial<Record<SqlTemplateName, string>>;
};

type BundleRows = {
  schemasRows: SchemasRow[];
  tablesRows: TablesRow[];
  columnsRows: ColumnsRow[];
  pkRows: PrimaryKeysRow[];
  fkRows: ForeignKeysRow[];
  uniqueRows: UniqueConstraintsRow[];
  checkRows: CheckConstraintsRow[];
  indexRows: IndexesRow[];
  enumRows: EnumsRow[];
  sequenceRows: SequencesRow[];
  viewRows: ViewsRow[];
  commentRows: CommentsRow[];
};

export type DescribePostgresExportInput = {
  bundlePath: string;
  filters?: IntrospectionFilters;
  /** Optional `schemaId` for the resulting `SqlSchema`. Defaults to `"introspected"`. */
  schemaId?: string;
};

export function describePostgresFromExport(
  input: DescribePostgresExportInput,
): IntrospectionResult {
  const manifest = readManifest(input.bundlePath);
  const rows = filterBundleRows(
    readBundleRows(input.bundlePath, manifest),
    input.filters,
  );

  return foldIntrospectionResult({
    schemaId: input.schemaId ?? "introspected",
    tableFilter: compileTableFilters(input.filters?.tables),
    declaredFilters: input.filters?.tables ?? [],
    ...rows,
  });
}

function readManifest(bundlePath: string): BundleManifest {
  const manifestPath = join(bundlePath, "manifest.json");
  if (!existsSync(manifestPath)) {
    throw new Error(
      `@askdb/introspect/postgres: export bundle is missing manifest.json at ${manifestPath}`,
    );
  }

  const parsed = parseJsonFile(manifestPath);
  if (!isObject(parsed)) {
    throw new Error(
      `@askdb/introspect/postgres: manifest.json must be a JSON object`,
    );
  }
  if (parsed.engine !== "postgres") {
    throw new Error(
      `@askdb/introspect/postgres: unsupported export bundle engine '${String(parsed.engine)}' (expected 'postgres')`,
    );
  }
  if (parsed.version !== POSTGRES_TEMPLATE_VERSION) {
    throw new Error(
      `@askdb/introspect/postgres: unsupported export bundle version '${String(parsed.version)}' (expected ${POSTGRES_TEMPLATE_VERSION})`,
    );
  }

  const files =
    parsed.files === undefined
      ? undefined
      : validateFilesMap(parsed.files, manifestPath);
  return { engine: "postgres", version: parsed.version, files };
}

function validateFilesMap(
  value: unknown,
  manifestPath: string,
): BundleManifest["files"] {
  if (!isObject(value)) {
    throw new Error(
      `@askdb/introspect/postgres: ${manifestPath} field 'files' must be an object`,
    );
  }
  const out: Partial<Record<SqlTemplateName, string>> = {};
  const known = new Set(POSTGRES_TEMPLATES.map((tpl) => tpl.name));
  for (const [name, file] of Object.entries(value)) {
    if (!known.has(name as SqlTemplateName)) {
      throw new Error(
        `@askdb/introspect/postgres: manifest.json references unknown template '${name}'`,
      );
    }
    if (typeof file !== "string" || file.length === 0) {
      throw new Error(
        `@askdb/introspect/postgres: manifest.json file for '${name}' must be a non-empty string`,
      );
    }
    out[name as SqlTemplateName] = file;
  }
  return out;
}

function filterBundleRows(rows: BundleRows, filters?: IntrospectionFilters): BundleRows {
  const include = filters?.schemas ?? Array.from(DEFAULT_INCLUDE_SCHEMAS);
  const includeSet = include.length === 0 ? undefined : new Set(include);
  const excludeSet = new Set(filters?.excludeSchemas ?? []);
  const keep = (schema: string) =>
    !isSystemSchema(schema) &&
    !excludeSet.has(schema) &&
    (includeSet === undefined || includeSet.has(schema));

  return {
    schemasRows: rows.schemasRows.filter((row) => keep(row.schema_name)),
    tablesRows: rows.tablesRows.filter((row) => keep(row.schema_name)),
    columnsRows: rows.columnsRows.filter((row) => keep(row.schema_name)),
    pkRows: rows.pkRows.filter((row) => keep(row.schema_name)),
    fkRows: rows.fkRows.filter((row) => keep(row.schema_name)),
    uniqueRows: rows.uniqueRows.filter((row) => keep(row.schema_name)),
    checkRows: rows.checkRows.filter((row) => keep(row.schema_name)),
    indexRows: rows.indexRows.filter((row) => keep(row.schema_name)),
    enumRows: rows.enumRows.filter((row) => keep(row.schema_name)),
    sequenceRows: rows.sequenceRows.filter((row) => keep(row.schema_name)),
    viewRows: rows.viewRows.filter((row) => keep(row.schema_name)),
    commentRows: rows.commentRows.filter((row) => keep(row.schema_name)),
  };
}

function isSystemSchema(schema: string): boolean {
  return SYSTEM_SCHEMA_PATTERNS.some((pattern) =>
    pattern.endsWith("_") ? schema.startsWith(pattern) : schema === pattern || schema.startsWith(`${pattern}_`),
  );
}

function readBundleRows(bundlePath: string, manifest: BundleManifest): BundleRows {
  const out: BundleRows = {
    schemasRows: [],
    tablesRows: [],
    columnsRows: [],
    pkRows: [],
    fkRows: [],
    uniqueRows: [],
    checkRows: [],
    indexRows: [],
    enumRows: [],
    sequenceRows: [],
    viewRows: [],
    commentRows: [],
  };

  for (const tpl of POSTGRES_TEMPLATES) {
    const path = resolveTemplateFile(bundlePath, manifest, tpl.name);
    const records = path.endsWith(".json")
      ? readTemplateJson(path, tpl)
      : readTemplateCsv(path, tpl);
    assignBundleRows(out, tpl.name, records);
  }
  return out;
}

function assignBundleRows(
  out: BundleRows,
  name: SqlTemplateName,
  records: Record<string, unknown>[],
): void {
  switch (name) {
    case "schemas":
      out.schemasRows = records as SchemasRow[];
      return;
    case "tables":
      out.tablesRows = records as TablesRow[];
      return;
    case "columns":
      out.columnsRows = records as ColumnsRow[];
      return;
    case "primary_keys":
      out.pkRows = records as PrimaryKeysRow[];
      return;
    case "foreign_keys":
      out.fkRows = records as ForeignKeysRow[];
      return;
    case "unique_constraints":
      out.uniqueRows = records as UniqueConstraintsRow[];
      return;
    case "check_constraints":
      out.checkRows = records as CheckConstraintsRow[];
      return;
    case "indexes":
      out.indexRows = records as IndexesRow[];
      return;
    case "enums":
      out.enumRows = records as EnumsRow[];
      return;
    case "sequences":
      out.sequenceRows = records as SequencesRow[];
      return;
    case "views":
      out.viewRows = records as ViewsRow[];
      return;
    case "comments":
      out.commentRows = records as CommentsRow[];
      return;
  }
}

function resolveTemplateFile(
  bundlePath: string,
  manifest: BundleManifest,
  name: SqlTemplateName,
): string {
  const explicit = manifest.files?.[name];
  if (explicit) {
    const path = join(bundlePath, explicit);
    if (!existsSync(path)) {
      throw new Error(
        `@askdb/introspect/postgres: export bundle is missing file '${explicit}' for template '${name}'`,
      );
    }
    return path;
  }

  const csv = join(bundlePath, `${name}.csv`);
  if (existsSync(csv)) return csv;
  const json = join(bundlePath, `${name}.json`);
  if (existsSync(json)) return json;
  throw new Error(
    `@askdb/introspect/postgres: export bundle is missing ${name}.csv or ${name}.json`,
  );
}

function readTemplateJson(path: string, tpl: SqlTemplate): Record<string, unknown>[] {
  const parsed = parseJsonFile(path);
  if (!Array.isArray(parsed)) {
    throw new Error(
      `@askdb/introspect/postgres: ${path} must contain a JSON array of row objects`,
    );
  }
  return parsed.map((row, idx) => normalizeRecord(path, tpl, row, idx));
}

function readTemplateCsv(path: string, tpl: SqlTemplate): Record<string, unknown>[] {
  const rows = parseCsv(readFileSync(path, "utf8"));
  if (rows.length === 0) {
    throw new Error(
      `@askdb/introspect/postgres: ${path} must include a header row`,
    );
  }
  const [header, ...data] = rows;
  assertHeader(path, tpl, header ?? []);
  return data
    .filter((row) => row.some((cell) => cell.length > 0))
    .map((row, rowIndex) => {
      const record: Record<string, unknown> = {};
      tpl.columns.forEach((column, index) => {
        record[column] = coerceField(tpl.name, column, row[index] ?? "");
      });
      return normalizeRecord(path, tpl, record, rowIndex);
    });
}

function normalizeRecord(
  path: string,
  tpl: SqlTemplate,
  row: unknown,
  index: number,
): Record<string, unknown> {
  if (!isObject(row)) {
    throw new Error(
      `@askdb/introspect/postgres: ${path} row ${index + 1} must be an object`,
    );
  }

  const record: Record<string, unknown> = {};
  for (const column of tpl.columns) {
    if (!(column in row)) {
      throw new Error(
        `@askdb/introspect/postgres: ${path} row ${index + 1} is missing column '${column}'`,
      );
    }
    record[column] = coerceField(tpl.name, column, row[column]);
  }
  return record;
}

function assertHeader(path: string, tpl: SqlTemplate, header: string[]): void {
  const expected = [...tpl.columns];
  if (
    header.length !== expected.length ||
    header.some((name, index) => name !== expected[index])
  ) {
    throw new Error(
      `@askdb/introspect/postgres: ${path} header mismatch for template '${tpl.name}' (expected [${expected.join(", ")}], got [${header.join(", ")}])`,
    );
  }
}

function coerceField(
  template: SqlTemplateName,
  column: string,
  value: unknown,
): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return value;
  if (value === "" || value === "\\N") return null;

  if (isNumberField(template, column)) return Number(value);
  if (isBooleanField(template, column)) return parseBoolean(template, column, value);
  return value;
}

function isNumberField(template: SqlTemplateName, column: string): boolean {
  return (
    column === "ordinal_position" ||
    column === "key_position" ||
    (template === "enums" && column === "enum_position")
  );
}

function isBooleanField(template: SqlTemplateName, column: string): boolean {
  return (
    column === "row_level_security" ||
    column === "is_nullable" ||
    column === "is_unique" ||
    column === "cycle_option" ||
    column === "is_materialized"
  );
}

function parseBoolean(
  template: SqlTemplateName,
  column: string,
  value: string,
): boolean {
  const normalized = value.toLowerCase();
  if (normalized === "true" || normalized === "t" || normalized === "1") {
    return true;
  }
  if (normalized === "false" || normalized === "f" || normalized === "0") {
    return false;
  }
  throw new Error(
    `@askdb/introspect/postgres: cannot parse boolean '${value}' for ${template}.${column}`,
  );
}

function parseJsonFile(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new Error(
      `@askdb/introspect/postgres: failed to parse JSON file ${path}: ${message}`,
    );
  }
}

function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i]!;
    if (inQuotes) {
      if (ch === '"' && input[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch === "\r") {
      // Ignore CR in CRLF.
    } else {
      field += ch;
    }
  }

  if (inQuotes) {
    throw new Error("@askdb/introspect/postgres: unterminated quoted CSV field");
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
