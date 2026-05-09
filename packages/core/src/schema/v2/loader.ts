import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { SchemaParseError } from "../../errors.js";
import { parseConceptsMarkdown, parseTableMarkdown } from "./parser.js";
import { v2SchemaJsonSchema, type V2SchemaJson } from "./physical.js";
import type {
  NormalizedSchemaV2,
  NormalizedV2Column,
  NormalizedV2Table,
  SchemaV2Warning,
} from "./normalized.js";
import type { V2ConceptsFrontmatter } from "./describable.js";

/** Bundled JSON produced by `askdb bundle` — packs the full directory into one file. */
type BundledSchemaJson = {
  bundled: true;
  physical: V2SchemaJson;
  tables: Record<string, string>; // filename → raw markdown content
  concepts?: string; // raw concepts.md content
};

/**
 * Load a Schema v2 artifact from a raw JSON string.
 *
 * Accepts a bundled JSON (has `bundled: true`) or a bare `schema.json` blob.
 * Rejects the pre-v2 format with a clear error.
 */
export function loadSchemaFromJson(raw: string): NormalizedSchemaV2 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new SchemaParseError("Failed to parse schema JSON string");
  }
  if (typeof parsed === "object" && parsed !== null && "bundled" in parsed) {
    return loadFromBundle(parsed as BundledSchemaJson, "<inline JSON>");
  }
  const physical = parsePhysicalLayer(parsed, "<inline JSON>");
  return buildNormalized(physical, {}, undefined, []);
}

/**
 * Load a Schema v2 artifact from disk.
 *
 * Autodetects between:
 *  - A v2 directory (`<schemaId>.schema/`) containing `schema.json`
 *  - A bundled JSON file (`*.bundle.json` or any JSON with `bundled: true`)
 *  - A direct path to a `schema.json` inside a directory
 */
export function loadSchema(path: string): NormalizedSchemaV2 {
  const resolved = resolve(path);
  const stat = statSync(resolved);

  if (stat.isDirectory()) {
    return loadFromDirectory(resolved);
  }

  const raw = readFileSync(resolved, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new SchemaParseError(`Failed to parse JSON at ${resolved}`);
  }

  // Could be a bundled JSON or a bare schema.json
  if (typeof parsed === "object" && parsed !== null && "bundled" in parsed) {
    return loadFromBundle(parsed as BundledSchemaJson, resolved);
  }

  // Bare schema.json — treat enclosing directory as the schema directory
  const physical = parsePhysicalLayer(parsed, resolved);
  return buildNormalized(physical, {}, undefined, []);
}

function loadFromDirectory(dir: string): NormalizedSchemaV2 {
  const schemaJsonPath = join(dir, "schema.json");
  let raw: string;
  try {
    raw = readFileSync(schemaJsonPath, "utf8");
  } catch {
    throw new SchemaParseError(`No schema.json found in directory: ${dir}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new SchemaParseError(`Failed to parse schema.json in ${dir}`);
  }

  const physical = parsePhysicalLayer(parsed, schemaJsonPath);

  // Load tables/*.md
  const tableDir = join(dir, "tables");
  const tableMarkdowns: Record<string, ReturnType<typeof parseTableMarkdown>> = {};
  try {
    const entries = readdirSync(tableDir);
    for (const entry of entries) {
      if (!entry.endsWith(".md")) continue;
      const filePath = join(tableDir, entry);
      const content = readFileSync(filePath, "utf8");
      const parsed = parseTableMarkdown(content, filePath);
      tableMarkdowns[parsed.frontmatter.id] = parsed;
    }
  } catch (e) {
    // tables/ directory is optional; only rethrow SchemaParseError
    if (e instanceof SchemaParseError) throw e;
  }

  // Load optional concepts.md
  let concepts: V2ConceptsFrontmatter | undefined;
  try {
    const conceptsPath = join(dir, "concepts.md");
    const content = readFileSync(conceptsPath, "utf8");
    concepts = parseConceptsMarkdown(content, conceptsPath).frontmatter;
  } catch {
    // optional
  }

  return buildNormalized(physical, tableMarkdowns, concepts, []);
}

function loadFromBundle(bundle: BundledSchemaJson, filePath: string): NormalizedSchemaV2 {
  const physical = parsePhysicalLayer(bundle.physical, filePath);
  const tableMarkdowns: Record<string, ReturnType<typeof parseTableMarkdown>> = {};

  for (const [filename, content] of Object.entries(bundle.tables)) {
    const parsed = parseTableMarkdown(content, filename);
    tableMarkdowns[parsed.frontmatter.id] = parsed;
  }

  let concepts: V2ConceptsFrontmatter | undefined;
  if (bundle.concepts) {
    concepts = parseConceptsMarkdown(bundle.concepts, "concepts.md").frontmatter;
  }

  return buildNormalized(physical, tableMarkdowns, concepts, []);
}

function parsePhysicalLayer(data: unknown, filePath: string): V2SchemaJson {
  // Detect and reject pre-v2 format
  if (
    typeof data === "object" &&
    data !== null &&
    "version" in data &&
    (data as Record<string, unknown>).version === 1
  ) {
    throw new SchemaParseError(
      `AskDB schema format \`version: 1\` is not supported as of \`@askdb/core@0.2.0\`. ` +
        `Migrate to Schema v2 format. See \`docs/contracts/schema-v2.md\` for the format contract.`,
    );
  }

  const result = v2SchemaJsonSchema.safeParse(data);
  if (!result.success) {
    throw new SchemaParseError(
      `Invalid schema.json at ${filePath}: ${result.error.message}`,
      result.error,
    );
  }
  return result.data;
}

function buildNormalized(
  physical: V2SchemaJson,
  tableMarkdowns: Record<string, ReturnType<typeof parseTableMarkdown>>,
  concepts: V2ConceptsFrontmatter | undefined,
  extraWarnings: SchemaV2Warning[],
): NormalizedSchemaV2 {
  const warnings: SchemaV2Warning[] = [...extraWarnings];

  // Build a map of all physical table ids and column ids for ID validation
  const physicalTableIds = new Set(physical.tables.map((t) => t.id));
  const physicalColumnIds = new Set(
    physical.tables.flatMap((t) => t.columns.map((c) => c.id)),
  );

  // Validate all table markdown IDs against physical layer
  for (const [id, parsed] of Object.entries(tableMarkdowns)) {
    if (!physicalTableIds.has(id)) {
      warnings.push({ kind: "orphaned_table_id", tableFile: `tables/${parsed.frontmatter.name}.md`, id });
    }
    for (const col of parsed.frontmatter.columns ?? []) {
      if (!physicalColumnIds.has(col.id)) {
        warnings.push({ kind: "orphaned_column_id", tableFile: `tables/${parsed.frontmatter.name}.md`, id: col.id });
      }
    }
  }

  const tables: NormalizedV2Table[] = physical.tables.map((physTable) => {
    const md = tableMarkdowns[physTable.id];
    const tableSensitive = physTable.sensitive === true;

    const columns: NormalizedV2Column[] = physTable.columns.map((physCol) => {
      const colSensitive = physCol.sensitive === true || tableSensitive;
      const mdCol = md?.frontmatter.columns?.find((c) => c.id === physCol.id);

      const normalized: NormalizedV2Column = {
        id: physCol.id,
        name: physCol.name,
        type: physCol.type,
        nullable: physCol.nullable,
        primaryKey: physCol.primaryKey ?? false,
        sensitive: colSensitive,
      };

      // Describable-layer fields excluded when sensitive
      if (!colSensitive && mdCol) {
        if (mdCol.description !== undefined) normalized.description = mdCol.description;
        if (mdCol.aliases?.length) normalized.aliases = mdCol.aliases;
        if (mdCol.enum?.length) normalized.enum = mdCol.enum;
      }

      return normalized;
    });

    const normalized: NormalizedV2Table = {
      id: physTable.id,
      name: physTable.name,
      sensitive: tableSensitive,
      columns,
      relationships: physTable.relationships,
    };

    // Table-level describable fields excluded when sensitive
    if (!tableSensitive && md) {
      const fm = md.frontmatter;
      if (fm.aliases?.length) normalized.aliases = fm.aliases;
      if (fm.primaryEntity) normalized.primaryEntity = fm.primaryEntity;

      // First paragraph of body is the table description
      const firstParagraph = extractFirstParagraph(md.body);
      if (firstParagraph) normalized.description = firstParagraph;

      const cql = md.sections["Common query language"];
      if (cql?.trim()) normalized.commonQueryLanguage = cql.trim();
    }

    return normalized;
  });

  return {
    schemaId: physical.schemaId,
    tables,
    concepts: concepts?.concepts,
    warnings,
  };
}

/** Extract the first non-heading, non-empty paragraph from a markdown body. */
function extractFirstParagraph(body: string): string | undefined {
  const lines = body.split("\n");
  const paragraphLines: string[] = [];
  let inParagraph = false;

  for (const line of lines) {
    if (line.startsWith("#")) continue; // skip headings
    if (line.trim() === "") {
      if (inParagraph) break;
      continue;
    }
    inParagraph = true;
    paragraphLines.push(line.trim());
  }

  return paragraphLines.length > 0 ? paragraphLines.join(" ") : undefined;
}
