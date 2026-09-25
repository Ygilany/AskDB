import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
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
import { parseTenantPolicyMarkdown, normalizeTenantPolicy } from "./tenant-policy-loader.js";
import type { NormalizedTenantPolicy } from "./tenant-policy.js";

/** Bundled JSON produced by `askdb bundle` — packs the full directory into one file. */
type BundledSchemaJson = {
  bundled: true;
  physical: V2SchemaJson;
  tables: Record<string, string>; // filename → raw markdown content
  concepts?: string; // raw concepts.md content
  tenantPolicy?: string; // raw tenant-policy.md content
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
  return buildNormalized(physical, {}, undefined, [], undefined);
}

/**
 * Load a Schema v2 artifact from disk.
 *
 * Autodetects between:
 *  - A v2 directory (`<schemaId>.schema/`) containing `schema.json`
 *  - A bundled JSON file (`*.bundle.json` or any JSON with `bundled: true`)
 *  - A direct path to a `schema.json` inside a directory — loaded exactly like the
 *    enclosing directory, including sibling `tables/*.md`, `concepts.md`, and
 *    `tenant-policy.md`
 *
 * Any other JSON file is treated as a standalone physical layer.
 *
 * Optional sibling files may be absent, but a present file that cannot be read
 * or parsed (e.g. malformed YAML front-matter in `tenant-policy.md`) throws
 * `SchemaParseError` — a broken tenant policy never silently disables tenancy.
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

  // A file named `schema.json` is the physical layer of a schema directory: load
  // the enclosing directory so sibling tables/*.md, concepts.md, and — critically —
  // tenant-policy.md apply exactly as they would for the directory path.
  if (basename(resolved) === "schema.json") {
    return loadFromDirectory(dirname(resolved));
  }

  // Any other bare JSON file is a standalone physical layer with no sibling files.
  const physical = parsePhysicalLayer(parsed, resolved);
  return buildNormalized(physical, {}, undefined, [], undefined);
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

  // The describable files below are optional, but only *absence* (ENOENT) is
  // tolerated. Any other read or parse failure is fatal: silently skipping a
  // broken tenant-policy.md would load the schema with tenant enforcement off.

  // Load optional tables/*.md
  const tableDir = join(dir, "tables");
  const tableMarkdowns: Record<string, ReturnType<typeof parseTableMarkdown>> = {};
  const entries = readOptionalDir(tableDir);
  for (const entry of entries ?? []) {
    if (!entry.endsWith(".md")) continue;
    const filePath = join(tableDir, entry);
    const content = readRequiredFile(filePath);
    const parsed = parseOrWrap(filePath, () => parseTableMarkdown(content, filePath));
    tableMarkdowns[parsed.frontmatter.id] = parsed;
  }

  // Load optional concepts.md
  let concepts: V2ConceptsFrontmatter | undefined;
  const conceptsPath = join(dir, "concepts.md");
  const conceptsContent = readOptionalFile(conceptsPath);
  if (conceptsContent !== undefined) {
    concepts = parseOrWrap(conceptsPath, () =>
      parseConceptsMarkdown(conceptsContent, conceptsPath),
    ).frontmatter;
  }

  // Load optional tenant-policy.md
  let tenantPolicy: NormalizedTenantPolicy | undefined;
  const policyPath = join(dir, "tenant-policy.md");
  const policyContent = readOptionalFile(policyPath);
  if (policyContent !== undefined) {
    tenantPolicy = parseOrWrap(policyPath, () => {
      const parsed = parseTenantPolicyMarkdown(policyContent, policyPath);
      const physicalTableIds = new Set(physical.tables.map((t) => t.id));
      const physicalColumnIds = new Set(
        physical.tables.flatMap((t) => t.columns.map((c) => c.id)),
      );
      return normalizeTenantPolicy(parsed, physicalTableIds, physicalColumnIds);
    });
  }

  return buildNormalized(physical, tableMarkdowns, concepts, [], tenantPolicy);
}

function isMissingPathError(e: unknown): boolean {
  return (
    typeof e === "object" && e !== null && (e as { code?: unknown }).code === "ENOENT"
  );
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Read an optional file: `undefined` when it does not exist, `SchemaParseError` on any other failure. */
function readOptionalFile(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch (e) {
    if (isMissingPathError(e)) return undefined;
    throw new SchemaParseError(`Failed to read ${path}: ${errorMessage(e)}`, e);
  }
}

/** List an optional directory: `undefined` when it does not exist, `SchemaParseError` on any other failure. */
function readOptionalDir(path: string): string[] | undefined {
  try {
    return readdirSync(path);
  } catch (e) {
    if (isMissingPathError(e)) return undefined;
    throw new SchemaParseError(`Failed to read directory ${path}: ${errorMessage(e)}`, e);
  }
}

function readRequiredFile(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch (e) {
    throw new SchemaParseError(`Failed to read ${path}: ${errorMessage(e)}`, e);
  }
}

/** Run a parse step; rethrow `SchemaParseError` as-is and wrap anything else with the file path. */
function parseOrWrap<T>(path: string, fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof SchemaParseError) throw e;
    throw new SchemaParseError(`Failed to parse ${path}: ${errorMessage(e)}`, e);
  }
}

function loadFromBundle(bundle: BundledSchemaJson, filePath: string): NormalizedSchemaV2 {
  const physical = parsePhysicalLayer(bundle.physical, filePath);
  const tableMarkdowns: Record<string, ReturnType<typeof parseTableMarkdown>> = {};

  for (const [filename, content] of Object.entries(bundle.tables)) {
    const parsed = parseTableMarkdown(content, filename);
    tableMarkdowns[parsed.frontmatter.id] = parsed;
  }

  // Mirror the directory loader: only an *absent* key means "no file". A present
  // value — including an empty string — is parsed and must be valid, so an empty
  // or corrupt tenantPolicy can never silently disable tenant enforcement.
  let concepts: V2ConceptsFrontmatter | undefined;
  const conceptsContent = bundledFileContent(bundle, "concepts", "concepts.md", filePath);
  if (conceptsContent !== undefined) {
    concepts = parseConceptsMarkdown(conceptsContent, "concepts.md").frontmatter;
  }

  let tenantPolicy: NormalizedTenantPolicy | undefined;
  const policyContent = bundledFileContent(bundle, "tenantPolicy", "tenant-policy.md", filePath);
  if (policyContent !== undefined) {
    const parsed = parseTenantPolicyMarkdown(policyContent, "tenant-policy.md");
    const physicalTableIds = new Set(physical.tables.map((t) => t.id));
    const physicalColumnIds = new Set(
      physical.tables.flatMap((t) => t.columns.map((c) => c.id)),
    );
    tenantPolicy = normalizeTenantPolicy(parsed, physicalTableIds, physicalColumnIds);
  }

  return buildNormalized(physical, tableMarkdowns, concepts, [], tenantPolicy);
}

/** Read an optional bundled markdown file: `undefined` only when the key is absent. */
function bundledFileContent(
  bundle: BundledSchemaJson,
  key: "concepts" | "tenantPolicy",
  fileName: string,
  bundlePath: string,
): string | undefined {
  const value: unknown = bundle[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new SchemaParseError(
      `Invalid bundle at ${bundlePath}: \`${key}\` must be the raw ${fileName} content (a string).`,
    );
  }
  return value;
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
  tenantPolicy: NormalizedTenantPolicy | undefined,
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
      schema: physTable.schema,
      sensitive: tableSensitive,
      columns,
      relationships: physTable.relationships,
    };

    if (md?.frontmatter.tracked !== undefined) {
      normalized.tracked = md.frontmatter.tracked;
    }

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
    provider: physical.provider,
    tables,
    concepts: concepts?.concepts,
    tenantPolicy,
    warnings,
  };
}

/** Extract the first non-heading, non-empty paragraph from a markdown body. */
function extractFirstParagraph(body: string): string | undefined {
  const lines = body.split("\n");
  const paragraphLines: string[] = [];
  let inParagraph = false;
  let seenHeading = false;

  for (const line of lines) {
    if (line.startsWith("#")) {
      // Skip the leading H1 (table title), but stop at any subsequent heading
      // so we don't leak content from the next section into the description.
      if (seenHeading) break;
      seenHeading = true;
      continue;
    }
    if (line.trim() === "") {
      if (inParagraph) break;
      continue;
    }
    inParagraph = true;
    paragraphLines.push(line.trim());
  }

  return paragraphLines.length > 0 ? paragraphLines.join(" ") : undefined;
}
