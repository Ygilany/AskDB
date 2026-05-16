import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import prismaInternals from "@prisma/internals";
import type {
  Connector,
  IntrospectionFilters,
  IntrospectionResult,
  IntrospectionWarning,
  SqlColumn,
  SqlEnum,
  SqlForeignKey,
  SqlForeignKeyAction,
  SqlIndex,
  SqlNamespace,
  SqlSchema,
  SqlTable,
  SqlUnique,
} from "@askdb/introspect";

export type PrismaSchemaProvider =
  | "postgresql"
  | "mysql"
  | "sqlite"
  | "sqlserver"
  | "cockroachdb";

export type PrismaIntrospectionInput = {
  /**
   * Path to a `schema.prisma` file or a directory containing one or more `.prisma` files.
   * When omitted, common project locations are probed automatically via {@link discoverPrismaSchemaPath}.
   */
  schemaPath?: string;
  /** Optional `schemaId` for the resulting `SqlSchema`. Defaults to `"introspected"`. */
  schemaId?: string;
  filters?: IntrospectionFilters;
};

type PrismaSchemaInput = string | Array<[filename: string, content: string]>;

type PrismaDmmfDocument = {
  datamodel: {
    models: PrismaModel[];
    enums: PrismaEnum[];
    indexes?: PrismaModelIndex[];
  };
};

type PrismaModel = {
  name: string;
  dbName: string | null;
  schema: string | null;
  fields: PrismaField[];
  uniqueFields: string[][];
  uniqueIndexes: Array<{ name: string; fields: string[] }>;
  documentation?: string;
  primaryKey: { name: string | null; fields: string[] } | null;
};

type PrismaField = {
  kind: "scalar" | "object" | "enum" | "unsupported";
  name: string;
  isRequired: boolean;
  isList: boolean;
  isUnique: boolean;
  isId: boolean;
  type: string;
  nativeType?: [string, string[]] | null;
  dbName?: string | null;
  hasDefaultValue: boolean;
  default?: unknown;
  relationFromFields?: string[];
  relationToFields?: string[];
  relationOnDelete?: string;
  relationOnUpdate?: string;
  relationName?: string;
  documentation?: string;
};

type PrismaEnum = {
  name: string;
  dbName?: string | null;
  values: Array<{ name: string; dbName: string | null }>;
  documentation?: string;
};

type PrismaModelIndex = {
  model: string;
  type: "id" | "normal" | "unique" | "fulltext";
  name?: string;
  dbName?: string;
  algorithm?: string;
  fields: Array<{ name: string }>;
};

type UnsupportedField = PrismaField & { order: number };
type ParsedSchemaHints = {
  fieldOrderByModel: Map<string, Map<string, number>>;
  unsupportedByModel: Map<string, UnsupportedField[]>;
};

const SUPPORTED_PROVIDERS = new Set<string>([
  "postgresql",
  "mysql",
  "sqlite",
  "sqlserver",
  "cockroachdb",
]);

const DEFAULT_SCHEMA = "public";
const { getConfig, getDMMF } = prismaInternals;

export function createPrismaConnector(): Connector<PrismaIntrospectionInput> {
  return {
    describe(input: PrismaIntrospectionInput): Promise<IntrospectionResult> {
      return describePrismaSchema(input);
    },
  };
}

const PRISMA_SCHEMA_CANDIDATES = ["prisma/schema.prisma", "schema.prisma"] as const;

/**
 * Probes standard Prisma schema locations relative to `cwd`.
 * Checks `prisma/schema.prisma`, `schema.prisma`, and `prisma/` (multi-file schemas) in order.
 * Throws if nothing is found.
 */
export function discoverPrismaSchemaPath(cwd: string = process.cwd()): string {
  for (const candidate of PRISMA_SCHEMA_CANDIDATES) {
    const full = join(cwd, candidate);
    try {
      if (statSync(full).isFile()) return full;
    } catch {
      // not found, continue
    }
  }
  const prismaDir = join(cwd, "prisma");
  try {
    if (statSync(prismaDir).isDirectory() && listPrismaFiles(prismaDir).length > 0) {
      return prismaDir;
    }
  } catch {
    // not found
  }
  throw new Error(
    `@askdb/prisma: could not auto-discover a Prisma schema under ${cwd}. ` +
      "Set introspection.providerConfig.prisma.schemaPath in askdb.config, or create prisma/schema.prisma.",
  );
}

export async function describePrismaSchema(
  input: PrismaIntrospectionInput,
): Promise<IntrospectionResult> {
  const schemaPath = input.schemaPath ?? discoverPrismaSchemaPath();
  const datamodel = stripDatasourceConnectionUrls(readPrismaSchema(schemaPath));
  const config = await getConfig({ datamodel });
  const provider = config.datasources[0]?.provider;
  assertSupportedProvider(provider);

  const dmmf = (await getDMMF({ datamodel })) as unknown as PrismaDmmfDocument;
  const hints = extractSchemaHints(datamodel);
  const warnings: IntrospectionWarning[] = [];
  const schema = foldPrismaDmmf({
    dmmf,
    hints,
    schemaId: input.schemaId ?? "introspected",
    filters: input.filters,
    warnings,
  });

  return {
    schema,
    warnings,
    isEmpty: schema.schemas.every((ns) => ns.tables.length === 0),
    viewDefinitions: {},
    provider: mapPrismaProviderToDialectId(provider),
  };
}

/**
 * Map a Prisma `datasource.provider` to the matching AskDB `DialectId`
 * (the stable id used by `@askdb/core`'s dialect registry).
 */
function mapPrismaProviderToDialectId(provider: PrismaSchemaProvider): string {
  switch (provider) {
    case "postgresql":
      return "postgres";
    case "mysql":
      return "mysql";
    case "sqlite":
      return "sqlite";
    case "sqlserver":
      return "sqlserver";
    case "cockroachdb":
      return "cockroachdb";
  }
}

function readPrismaSchema(schemaPath: string): PrismaSchemaInput {
  const absolute = resolve(schemaPath);
  const stat = statSync(absolute);
  if (stat.isFile()) {
    if (!absolute.endsWith(".prisma")) {
      throw new Error(`@askdb/prisma: expected a .prisma file, got ${schemaPath}`);
    }
    return readFileSync(absolute, "utf8");
  }

  if (!stat.isDirectory()) {
    throw new Error(`@askdb/prisma: schema path is not a file or directory: ${schemaPath}`);
  }

  const files = listPrismaFiles(absolute);
  if (files.length === 0) {
    throw new Error(`@askdb/prisma: no .prisma files found in ${schemaPath}`);
  }
  return files.map((file) => [file, readFileSync(file, "utf8")]);
}

function listPrismaFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listPrismaFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".prisma")) {
      files.push(fullPath);
    }
  }
  return files.sort((a, b) => a.localeCompare(b));
}

function assertSupportedProvider(
  provider: string | undefined,
): asserts provider is PrismaSchemaProvider {
  if (!provider) {
    throw new Error("@askdb/prisma: Prisma schema must declare a datasource provider.");
  }
  if (!SUPPORTED_PROVIDERS.has(provider)) {
    throw new Error(
      `@askdb/prisma: unsupported Prisma datasource provider '${provider}'. ` +
        "Supported relational providers are postgresql, mysql, sqlite, sqlserver, and cockroachdb.",
    );
  }
}

function foldPrismaDmmf(input: {
  dmmf: PrismaDmmfDocument;
  hints: ParsedSchemaHints;
  schemaId: string;
  filters: IntrospectionFilters | undefined;
  warnings: IntrospectionWarning[];
}): SqlSchema {
  const tableFilter = compileTableFilters(input.filters?.tables);
  const includeSchemas = input.filters?.schemas
    ? new Set(input.filters.schemas)
    : undefined;
  const excludeSchemas = new Set(input.filters?.excludeSchemas ?? []);
  const modelsByName = new Map(input.dmmf.datamodel.models.map((m) => [m.name, m]));
  const tablesBySchema = new Map<string, SqlTable[]>();
  const matchedFilters = new Set<string>();

  for (const model of input.dmmf.datamodel.models) {
    const schemaName = model.schema ?? DEFAULT_SCHEMA;
    if (includeSchemas && !includeSchemas.has(schemaName)) continue;
    if (excludeSchemas.has(schemaName)) continue;

    const tableName = dbName(model);
    const qualified = `${schemaName}.${tableName}`;
    if (!tableFilter(qualified)) continue;
    markMatchedFilters(qualified, input.filters?.tables, matchedFilters);

    const table = buildTable({
      model,
      hints: input.hints,
      modelsByName,
      dmmfIndexes: input.dmmf.datamodel.indexes ?? [],
      schemaName,
      tableName,
      warnings: input.warnings,
    });
    const list = tablesBySchema.get(schemaName) ?? [];
    list.push(table);
    tablesBySchema.set(schemaName, list);
  }

  for (const pattern of input.filters?.tables ?? []) {
    if (!matchedFilters.has(pattern)) {
      input.warnings.push({ code: "ambiguous_filter", filter: pattern });
    }
  }

  const enumsBySchema = new Map<string, SqlEnum[]>();
  const enumSchema = DEFAULT_SCHEMA;
  if (!includeSchemas || includeSchemas.has(enumSchema)) {
    for (const enumDef of input.dmmf.datamodel.enums) {
      if (excludeSchemas.has(enumSchema)) continue;
      const list = enumsBySchema.get(enumSchema) ?? [];
      list.push({
        schema: enumSchema,
        name: enumDef.dbName ?? enumDef.name,
        values: enumDef.values.map((value) => value.dbName ?? value.name),
      });
      enumsBySchema.set(enumSchema, list);
    }
  }

  const schemaNames = sortedUnique([
    ...tablesBySchema.keys(),
    ...enumsBySchema.keys(),
  ]);
  const schemas: SqlNamespace[] = schemaNames.map((name) => ({
    name,
    tables: (tablesBySchema.get(name) ?? []).slice().sort(byName),
    views: [],
    enums: (enumsBySchema.get(name) ?? []).slice().sort(byName),
    sequences: [],
  }));

  return { schemaId: input.schemaId, schemas };
}

function buildTable(input: {
  model: PrismaModel;
  hints: ParsedSchemaHints;
  modelsByName: Map<string, PrismaModel>;
  dmmfIndexes: PrismaModelIndex[];
  schemaName: string;
  tableName: string;
  warnings: IntrospectionWarning[];
}): SqlTable {
  const scalarFields = [
    ...input.model.fields.filter((field) => field.kind !== "object"),
    ...(input.hints.unsupportedByModel.get(input.model.name) ?? []),
  ].sort(
    (a, b) =>
      fieldOrder(input.hints, input.model.name, a) -
      fieldOrder(input.hints, input.model.name, b),
  );
  const physicalNameByField = new Map(
    scalarFields.map((field) => [field.name, dbName(field)]),
  );
  const pkColumns = primaryKeyFieldNames(input.model).map(
    (name) => physicalNameByField.get(name) ?? name,
  );
  const pkSet = new Set(pkColumns);

  const columns: SqlColumn[] = scalarFields.map((field, idx) => {
    const columnName = dbName(field);
    if (field.kind === "unsupported") {
      input.warnings.push({
        code: "unsupported_type",
        column: `${input.schemaName}.${input.tableName}.${columnName}`,
        type: field.type,
      });
    }
    return {
      id: makeColumnId(input.schemaName, input.tableName, columnName),
      name: columnName,
      ordinalPosition: idx + 1,
      dataType: renderFieldType(field),
      udtName: field.type,
      nullable: !field.isRequired,
      primaryKey: pkSet.has(columnName),
      defaultExpression: renderDefault(field),
      comment: field.documentation,
    };
  });

  return {
    id: makeTableId(input.schemaName, input.tableName),
    schema: input.schemaName,
    name: input.tableName,
    comment: input.model.documentation,
    columns,
    primaryKey: pkColumns.length > 0 ? { columns: pkColumns } : undefined,
    foreignKeys: buildForeignKeys(input.model, input.modelsByName, physicalNameByField)
      .sort((a, b) => a.name.localeCompare(b.name)),
    uniqueConstraints: buildUniques(input.model, physicalNameByField, input.tableName),
    indexes: buildIndexes(input.model, input.dmmfIndexes, physicalNameByField),
    checkConstraints: [],
  };
}

function fieldOrder(
  hints: ParsedSchemaHints,
  modelName: string,
  field: PrismaField | UnsupportedField,
): number {
  if ("order" in field) return field.order;
  return hints.fieldOrderByModel.get(modelName)?.get(field.name) ?? Number.MAX_SAFE_INTEGER;
}

function primaryKeyFieldNames(model: PrismaModel): string[] {
  if (model.primaryKey?.fields && model.primaryKey.fields.length > 0) {
    return [...model.primaryKey.fields];
  }
  return model.fields.filter((field) => field.isId).map((field) => field.name);
}

function buildForeignKeys(
  model: PrismaModel,
  modelsByName: Map<string, PrismaModel>,
  physicalNameByField: Map<string, string>,
): SqlForeignKey[] {
  const localSchema = model.schema ?? DEFAULT_SCHEMA;
  const localTable = dbName(model);
  const out: SqlForeignKey[] = [];

  for (const field of model.fields) {
    if (field.kind !== "object") continue;
    if (!field.relationFromFields || field.relationFromFields.length === 0) continue;
    if (!field.relationToFields || field.relationToFields.length === 0) continue;

    const target = modelsByName.get(field.type);
    if (!target) continue;
    const targetScalarFields = new Map(
      target.fields
        .filter((targetField) => targetField.kind !== "object")
        .map((targetField) => [targetField.name, dbName(targetField)]),
    );
    const columns = field.relationFromFields.map(
      (name) => physicalNameByField.get(name) ?? name,
    );
    const referencedColumns = field.relationToFields.map(
      (name) => targetScalarFields.get(name) ?? name,
    );
    out.push({
      name: `${localTable}_${columns.join("_")}_fkey`,
      columns,
      references: {
        schema: target.schema ?? DEFAULT_SCHEMA,
        table: dbName(target),
        columns: referencedColumns,
      },
      onDelete: mapReferentialAction(field.relationOnDelete),
      onUpdate: mapReferentialAction(field.relationOnUpdate),
    });
  }

  return out;
}

function buildUniques(
  model: PrismaModel,
  physicalNameByField: Map<string, string>,
  tableName: string,
): SqlUnique[] {
  const byColumns = new Map<string, SqlUnique>();
  const add = (fields: string[], name?: string | null) => {
    const columns = fields.map((field) => physicalNameByField.get(field) ?? field);
    if (columns.length === 0) return;
    const key = columns.join("\0");
    if (byColumns.has(key)) return;
    byColumns.set(key, {
      name: name || `${tableName}_${columns.join("_")}_key`,
      columns,
    });
  };

  for (const field of model.fields) {
    if (field.kind !== "object" && field.isUnique) add([field.name]);
  }
  for (const unique of model.uniqueIndexes) add(unique.fields, unique.name);
  for (const unique of model.uniqueFields) add(unique);

  return Array.from(byColumns.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function buildIndexes(
  model: PrismaModel,
  indexes: PrismaModelIndex[],
  physicalNameByField: Map<string, string>,
): SqlIndex[] {
  return indexes
    .filter((index) => index.model === model.name && index.type !== "id")
    .map((index) => {
      const columns = index.fields.map(
        (field) => physicalNameByField.get(field.name) ?? field.name,
      );
      return {
        name: index.dbName ?? index.name ?? `${dbName(model)}_${columns.join("_")}_idx`,
        columns,
        unique: index.type === "unique",
        method: index.algorithm ?? index.type,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function renderFieldType(field: PrismaField): string {
  const base = field.nativeType
    ? `${field.nativeType[0]}${field.nativeType[1].length > 0 ? `(${field.nativeType[1].join(",")})` : ""}`
    : field.type;
  return field.isList ? `${base}[]` : base;
}

function renderDefault(field: PrismaField): string | undefined {
  if (!field.hasDefaultValue || field.default === undefined) return undefined;
  const value = field.default;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(String).join(", ");
  if (isRecord(value) && typeof value.name === "string") {
    const args = Array.isArray(value.args) ? value.args.map(String).join(", ") : "";
    return `${value.name}(${args})`;
  }
  return JSON.stringify(value);
}

function mapReferentialAction(
  action: string | undefined,
): SqlForeignKeyAction | undefined {
  switch (action?.toLowerCase()) {
    case "cascade":
      return "cascade";
    case "restrict":
      return "restrict";
    case "setnull":
    case "set null":
      return "set null";
    case "setdefault":
    case "set default":
      return "set default";
    case "noaction":
    case "no action":
      return "no action";
    default:
      return undefined;
  }
}

function dbName(value: { name: string; dbName?: string | null }): string {
  return value.dbName ?? value.name;
}

function extractSchemaHints(datamodel: PrismaSchemaInput): ParsedSchemaHints {
  const body = schemaInputToText(datamodel);
  const fieldOrderByModel = new Map<string, Map<string, number>>();
  const unsupportedByModel = new Map<string, UnsupportedField[]>();
  const modelPattern = /model\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{([\s\S]*?)\n\}/g;
  let modelMatch: RegExpExecArray | null;

  while ((modelMatch = modelPattern.exec(body)) !== null) {
    const modelName = modelMatch[1]!;
    const block = modelMatch[2]!;
    const order = new Map<string, number>();
    const unsupported: UnsupportedField[] = [];

    for (const rawLine of block.split("\n")) {
      const line = rawLine.trim();
      if (!line || line.startsWith("//") || line.startsWith("@@")) continue;
      const match = /^([A-Za-z_][A-Za-z0-9_]*)\s+(\S+)(?:\s+(.*))?$/.exec(line);
      if (!match) continue;
      const [, fieldName, typeToken, attributes = ""] = match;
      if (!fieldName || !typeToken) continue;
      const position = order.size + 1;
      order.set(fieldName, position);

      const unsupportedMatch = /^Unsupported\("([^"]+)"\)(\[\])?(\?)?$/.exec(typeToken);
      if (!unsupportedMatch) continue;
      const mappedName = /@map\("([^"]+)"\)/.exec(attributes)?.[1] ?? null;
      unsupported.push({
        kind: "unsupported",
        name: fieldName,
        isRequired: unsupportedMatch[3] !== "?",
        isList: unsupportedMatch[2] === "[]",
        isUnique: attributes.includes("@unique"),
        isId: attributes.includes("@id"),
        type: unsupportedMatch[1]!,
        dbName: mappedName,
        hasDefaultValue: attributes.includes("@default("),
        order: position,
      });
    }

    fieldOrderByModel.set(modelName, order);
    if (unsupported.length > 0) unsupportedByModel.set(modelName, unsupported);
  }

  return { fieldOrderByModel, unsupportedByModel };
}

function schemaInputToText(datamodel: PrismaSchemaInput): string {
  if (typeof datamodel === "string") return datamodel;
  return datamodel.map(([, content]) => content).join("\n");
}

function stripDatasourceConnectionUrls(datamodel: PrismaSchemaInput): PrismaSchemaInput {
  if (typeof datamodel === "string") return stripDatasourceConnectionUrlsFromText(datamodel);
  return datamodel.map(([filename, content]) => [
    filename,
    stripDatasourceConnectionUrlsFromText(content),
  ]);
}

function stripDatasourceConnectionUrlsFromText(content: string): string {
  let inDatasource = false;
  return content
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      if (/^datasource\s+[A-Za-z_][A-Za-z0-9_]*\s*\{/.test(trimmed)) {
        inDatasource = true;
        return true;
      }
      if (inDatasource && trimmed === "}") {
        inDatasource = false;
        return true;
      }
      if (inDatasource && /^(url|directUrl)\s*=/.test(trimmed)) {
        return false;
      }
      return true;
    })
    .join("\n");
}

function makeTableId(schemaName: string, tableName: string): string {
  return `table:${schemaName}.${tableName}`;
}

function makeColumnId(
  schemaName: string,
  tableName: string,
  columnName: string,
): string {
  return `table:${schemaName}.${tableName}#${columnName}`;
}

function sortedUnique(values: Iterable<string>): string[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

function byName<T extends { name: string }>(a: T, b: T): number {
  return a.name.localeCompare(b.name);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function markMatchedFilters(
  qualified: string,
  patterns: ReadonlyArray<string> | undefined,
  matched: Set<string>,
): void {
  for (const pattern of patterns ?? []) {
    if (compileGlob(pattern).test(qualified)) matched.add(pattern);
  }
}

function compileTableFilters(
  patterns: ReadonlyArray<string> | undefined,
): (qualifiedName: string) => boolean {
  if (!patterns || patterns.length === 0) return () => true;
  const compiled = patterns.map(compileGlob);
  return (qualifiedName) => compiled.some((re) => re.test(qualifiedName));
}

function compileGlob(pattern: string): RegExp {
  let out = "^";
  for (const ch of pattern) {
    if (ch === "*") out += ".*";
    else if (ch === "?") out += ".";
    else if (/[.+^${}()|[\]\\]/.test(ch)) out += `\\${ch}`;
    else out += ch;
  }
  return new RegExp(`${out}$`);
}
