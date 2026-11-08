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
import type { ParsedTableMarkdown, V2ConceptsFrontmatter } from "./describable.js";
import { parseTenantPolicyMarkdown, normalizeTenantPolicy } from "./tenant-policy-loader.js";
import type { NormalizedTenantPolicy } from "./tenant-policy.js";

/**
 * A parsed `tables/*.md` file plus the path it was read from (relative to the schema
 * directory, e.g. `tables/customer-records.md`). Filenames are free-form, so warnings
 * name this path rather than one derived from front-matter.
 */
type LoadedTableMarkdown = {
  tableFile: string;
  parsed: ReturnType<typeof parseTableMarkdown>;
};

/**
 * Single-file form of a Schema v2 directory: what `askdb bundle` writes and what
 * `loadSchema()` / `loadSchemaFromJson()` read back. It carries every file the
 * directory loader reads, so loading a bundle gives the same result as loading the
 * directory. This loader defines the format; writers such as `@askdb/enrich`'s
 * `bundleSchemaDirectory()` produce this type so they can't drop a file it reads.
 */
export type BundledSchemaV2 = {
  bundled: true;
  /** `schema.json`. */
  physical: V2SchemaJson;
  /** `tables/` filename → raw markdown content, for every `tables/*.md`. */
  tables: Record<string, string>;
  /** Raw `concepts.md` content; present when the file exists. */
  concepts?: string;
  /**
   * Raw `tenant-policy.md` content; present when the file exists. Without it a
   * multi-tenant schema loads with no tenant policy, and `ask()` neither requires a
   * `tenantScope` nor injects tenant predicates.
   */
  tenantPolicy?: string;
};

/** Each physical column ID → the ID of the table that owns it, read from `schema.json` (a SQL Server table name can hold `#`). */
function columnOwnersOf(physical: Pick<V2SchemaJson, "tables">): Map<string, string> {
  return new Map(physical.tables.flatMap((t) => t.columns.map((c) => [c.id, t.id] as const)));
}

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
    return loadFromBundle(parsed as BundledSchemaV2, "<inline JSON>");
  }
  const physical = parsePhysicalLayer(parsed, "<inline JSON>");
  return buildNormalized(physical, {}, undefined, undefined);
}

/**
 * Load a Schema v2 artifact from disk.
 *
 * Autodetects between:
 *  - A v2 directory (`<schemaId>.schema/`) containing `schema.json`
 *  - A bundled JSON file (`*.bundle.json` or any JSON with `bundled: true`)
 *  - A direct path to a `schema.json` inside a directory, matched in any case
 *    (`Schema.json` too) — loaded exactly like the enclosing directory, including
 *    sibling `tables/*.md`, `concepts.md`, and `tenant-policy.md`
 *
 * Any other JSON file is treated as a standalone physical layer, unless its
 * directory also holds `tenant-policy.md`, `tables/` or `concepts.md`, in any case:
 * loading it alone would ignore them, so that throws `SchemaParseError`. To load only
 * the physical layer of such a file, pass its content to `loadSchemaFromJson()`.
 *
 * A directory is read by {@link readSchemaDirectory}, so a file name the loader looks
 * up must be spelled exactly (`Tenant-Policy.md` throws on every OS). Optional sibling
 * files may be absent, but a present file that cannot be read or parsed (e.g.
 * malformed YAML front-matter in `tenant-policy.md`) throws `SchemaParseError` — a
 * broken tenant policy never silently disables tenancy.
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
    return loadFromBundle(parsed as BundledSchemaV2, resolved);
  }

  // A file named `schema.json` is the physical layer of a schema directory: load
  // the enclosing directory so sibling tables/*.md, concepts.md, and — critically —
  // tenant-policy.md apply exactly as they would for the directory path. The name
  // matches in any case: on case-insensitive filesystems (macOS, Windows defaults)
  // `Schema.json` opens `schema.json`, and missing that would drop the tenant policy.
  // The physical layer is read from the given path, which may not be spelled
  // `schema.json` on a case-sensitive filesystem.
  if (basename(resolved).toLowerCase() === "schema.json") {
    return loadFromDirectory(dirname(resolved), resolved);
  }

  // Any other bare JSON file is a standalone physical layer with no sibling files,
  // unless it sits in a schema directory (fails closed, see below).
  assertNotInSchemaDirectory(resolved);
  const physical = parsePhysicalLayer(parsed, resolved);
  return buildNormalized(physical, {}, undefined, undefined);
}

/**
 * Every optional file the directory loader reads beside `schema.json`, by the exact
 * name it reads, keyed by the `BundledSchemaV2` field that carries it. `satisfies`
 * stops a new bundle field from compiling until it is named here, so the directory
 * read, the bundle loader and `assertNotInSchemaDirectory` share one list.
 */
const SCHEMA_DIRECTORY_FILES = {
  tenantPolicy: "tenant-policy.md",
  tables: "tables",
  concepts: "concepts.md",
} as const satisfies Record<Exclude<keyof BundledSchemaV2, "bundled" | "physical">, string>;

/**
 * A standalone JSON file must not sit beside schema-directory files. Loading it
 * alone would ignore them, so `cp schema.json prod-schema.json` would silently drop
 * the tenant policy (and with it `ask()`'s tenant scope) and every `tables/*.md`
 * `sensitive: true`. Fail closed instead and say how to load it. A sibling counts in
 * any case: a wrong-case `Tenant-Policy.md` is still a schema file the load would ignore.
 */
function assertNotInSchemaDirectory(filePath: string): void {
  const siblingKeys = new Set(Object.values(SCHEMA_DIRECTORY_FILES).map(caseKey));
  const present = readRequiredDir(dirname(filePath))
    .filter((entry) => siblingKeys.has(caseKey(entry)))
    .sort();
  if (present.length === 0) return;
  throw new SchemaParseError(
    `Refusing to load ${filePath} as a standalone physical layer: its directory also holds ` +
      `${present.join(", ")}, which loading the file alone would ignore (an ignored ` +
      `tenant-policy.md turns tenant enforcement off). Pass the directory, rename the file ` +
      `to schema.json, or pass its content to loadSchemaFromJson() to load only the physical layer.`,
  );
}

/**
 * Read a Schema v2 directory into its bundle form, the single file `askdb bundle`
 * writes. Loading the result with `loadSchemaFromJson()` gives the same schema as
 * `loadSchema(dir)`, which reads the directory through this function too.
 *
 * Every name it looks up must be spelled exactly: `schema.json`, `tenant-policy.md`,
 * `concepts.md`, `tables/`, and the `.md` extension in `tables/`. A file that matches
 * one only when case is ignored (`Tenant-Policy.md`, `tables/orders.MD`) throws
 * `SchemaParseError` on every OS. Where file names are case-sensitive (Linux) it would
 * otherwise be skipped, and a skipped `tenant-policy.md` turns tenant enforcement off.
 *
 * An optional file counts as absent only when the directory doesn't list it. A listed
 * file that can't be read throws `SchemaParseError`, so does a `schema.json` that is
 * missing or invalid. The file contents are returned unparsed, except `schema.json`.
 */
export function readSchemaDirectory(dir: string): BundledSchemaV2 {
  return readDirectory(resolve(dir));
}

const SCHEMA_JSON = "schema.json";

/**
 * {@link readSchemaDirectory}, reading the physical layer from `schemaJsonPath` when
 * the caller named that file (`loadSchema("<dir>/Schema.json")`). That name is the
 * caller's, so it is read as given and only the names this function looks up itself
 * are checked.
 */
function readDirectory(dir: string, schemaJsonPath?: string): BundledSchemaV2 {
  const entries = readRequiredDir(dir);
  const listed = new Set(entries);
  const tables = SCHEMA_DIRECTORY_FILES.tables;
  const tableDir = join(dir, tables);
  // Sorted so warning order is deterministic (readdir order is filesystem-dependent)
  // and matches the bundle loader, which sorts its `tables` keys the same way.
  const tableEntries = listed.has(tables) ? readRequiredDir(tableDir).sort() : [];
  assertExactNames(dir, entries, tableEntries, schemaJsonPath === undefined);

  if (schemaJsonPath === undefined && !listed.has(SCHEMA_JSON)) {
    throw new SchemaParseError(`No schema.json found in directory: ${dir}`);
  }
  const physicalPath = schemaJsonPath ?? join(dir, SCHEMA_JSON);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readRequiredFile(physicalPath));
  } catch (e) {
    if (e instanceof SchemaParseError) throw e;
    throw new SchemaParseError(`Failed to parse schema.json in ${dir}`, e);
  }
  const physical = parsePhysicalLayer(parsed, physicalPath);

  const tableFiles: Record<string, string> = {};
  for (const entry of tableEntries) {
    if (entry.endsWith(".md")) tableFiles[entry] = readRequiredFile(join(tableDir, entry));
  }
  const bundle: BundledSchemaV2 = { bundled: true, physical, tables: tableFiles };
  for (const key of ["concepts", "tenantPolicy"] as const) {
    const name = SCHEMA_DIRECTORY_FILES[key];
    if (listed.has(name)) bundle[key] = readRequiredFile(join(dir, name));
  }
  return bundle;
}

/**
 * The key two names share when a case-insensitive filesystem stores them as one file.
 * It is ADR 0013's key, checked there against Unicode full case folding: APFS folds
 * `tableſ` (long s) to `tables`, which `toLowerCase()` alone misses.
 */
function caseKey(name: string): string {
  return name.normalize("NFC").toLowerCase().toUpperCase().toLowerCase();
}

/** A `tables/` entry's name with its extension lowercased: `users.MD` → `users.md`. */
function tableFileKey(entry: string): string {
  return entry.slice(0, -3) + entry.slice(-3).toLowerCase();
}

/**
 * Throw when a directory entry matches a name the loader looks up only when case is
 * ignored. Where file names are case-sensitive (Linux), the loader would skip that
 * file; on macOS and Windows the same directory loads. Checking on every OS makes a
 * directory fail on a laptop the way it would fail open in production. One error
 * names every problem, including the files in a wrong-case `Tables/`, so the user
 * fixes them in one pass.
 */
function assertExactNames(
  dir: string,
  entries: readonly string[],
  tableEntries: readonly string[],
  checkSchemaJson: boolean,
): void {
  const tables = SCHEMA_DIRECTORY_FILES.tables;
  const names = [...(checkSchemaJson ? [SCHEMA_JSON] : []), ...Object.values(SCHEMA_DIRECTORY_FILES)];
  const problems = spellingProblems(entries, names, caseKey, "");

  // A lone wrong-case `Tables/` is listed too, so its files are named in this error.
  const tablesSpellings = entries.filter((entry) => caseKey(entry) === tables);
  const wrongCaseTables =
    tablesSpellings.length === 1 && tablesSpellings[0] !== tables
      ? listOrEmpty(join(dir, tablesSpellings[0]!)).sort()
      : [];
  const files = [...tableEntries, ...wrongCaseTables];
  const mdNames = [
    ...new Set(files.map(tableFileKey).filter((key) => key.endsWith(".md"))),
  ];
  problems.push(...spellingProblems(files, mdNames, tableFileKey, `${tables}/`));

  if (problems.length === 0) return;
  throw new SchemaParseError(
    `Schema directory ${dir} has a file name in the wrong case: ${problems.join("; ")}. ` +
      `The loader reads these names exactly. Where file names are case-sensitive (Linux) it ` +
      `would skip the file, and a skipped tenant-policy.md turns tenant enforcement off, so it ` +
      `refuses on every OS.`,
  );
}

/**
 * For each name, the entries that spell it differently under `key`: one wrong spelling
 * is a rename. Two or more spellings can coexist only where names are case-sensitive,
 * and renaming one onto the other would overwrite a file or move a directory inside
 * the other, so the problem says to keep one instead.
 */
function spellingProblems(
  entries: readonly string[],
  names: readonly string[],
  key: (name: string) => string,
  prefix: string,
): string[] {
  const problems: string[] = [];
  for (const name of names) {
    const spellings = entries.filter((entry) => key(entry) === key(name)).sort();
    if (spellings.length === 0 || (spellings.length === 1 && spellings[0] === name)) continue;
    problems.push(
      spellings.length === 1
        ? `rename ${prefix}${spellings[0]} to ${prefix}${name}`
        : `keep one of ${spellings.map((s) => prefix + s).join(", ")}, named ${prefix}${name}`,
    );
  }
  return problems;
}

/** List a directory whose contents only add detail to an error: `[]` if it can't be listed. */
function listOrEmpty(path: string): string[] {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
}

function loadFromDirectory(dir: string, schemaJsonPath?: string): NormalizedSchemaV2 {
  const files = readDirectory(dir, schemaJsonPath);
  // Errors name the file on disk.
  return loadFromFiles(files, files.physical, (file) => join(dir, file), dir);
}

function loadFromBundle(bundle: BundledSchemaV2, filePath: string): NormalizedSchemaV2 {
  const physical = parsePhysicalLayer(bundle.physical, filePath);
  assertBundledTables(bundle.tables, filePath);
  // Errors name the bundled file and the bundle that holds it: the user has the
  // bundle on disk, not a tenant-policy.md or concepts.md.
  return loadFromFiles(bundle, physical, (file) => `${file} (in ${filePath})`, filePath);
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** List a directory the loader needs: `SchemaParseError` on any failure. */
function readRequiredDir(path: string): string[] {
  try {
    return readdirSync(path);
  } catch (e) {
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

/**
 * Run a parse step so its error names the file: a `SchemaParseError` that already
 * names `path` is rethrown as-is; any other error (including a `SchemaParseError`
 * from a check that doesn't know the file, such as a tenant-root placeholder
 * collision) is wrapped with the path.
 */
function parseOrWrap<T>(path: string, fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof SchemaParseError && e.message.includes(path)) throw e;
    throw new SchemaParseError(`Failed to parse ${path}: ${errorMessage(e)}`, e);
  }
}

/**
 * Parse a schema's files, read from a directory or carried in a bundle, against its
 * validated physical layer. `fileLabel` turns a file's path in the schema directory
 * (`tables/orders.md`, `tenant-policy.md`) into the name errors use.
 */
function loadFromFiles(
  files: BundledSchemaV2,
  physical: V2SchemaJson,
  fileLabel: (file: string) => string,
  schemaPath: string,
): NormalizedSchemaV2 {
  const tableMarkdowns: Record<string, LoadedTableMarkdown> = {};
  // `tables` keys are the `tables/` filenames, so warnings name the file as it sits in
  // the directory. Sorted so both forms report warnings in one order.
  for (const [filename, content] of Object.entries(files.tables).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  )) {
    const tableFile = `${SCHEMA_DIRECTORY_FILES.tables}/${filename}`;
    const label = fileLabel(tableFile);
    const parsed = parseOrWrap(label, () => parseTableMarkdown(content, label));
    addTableMarkdown(tableMarkdowns, { tableFile, parsed }, schemaPath);
  }

  // Only an *absent* file (or bundle key) means "no file". A present value —
  // including an empty string — is parsed and must be valid, so an empty or corrupt
  // tenant policy can never silently disable tenant enforcement.
  let concepts: V2ConceptsFrontmatter | undefined;
  const conceptsContent = bundledFileContent(files, "concepts", schemaPath);
  if (conceptsContent !== undefined) {
    const conceptsFile = fileLabel(SCHEMA_DIRECTORY_FILES.concepts);
    concepts = parseOrWrap(conceptsFile, () =>
      parseConceptsMarkdown(conceptsContent, conceptsFile),
    ).frontmatter;
  }

  let tenantPolicy: NormalizedTenantPolicy | undefined;
  const policyContent = bundledFileContent(files, "tenantPolicy", schemaPath);
  if (policyContent !== undefined) {
    const policyFile = fileLabel(SCHEMA_DIRECTORY_FILES.tenantPolicy);
    tenantPolicy = parseOrWrap(policyFile, () => {
      const parsed = parseTenantPolicyMarkdown(policyContent, policyFile);
      const physicalTableIds = new Set(physical.tables.map((t) => t.id));
      return normalizeTenantPolicy(parsed, physicalTableIds, columnOwnersOf(physical));
    });
  }

  return buildNormalized(physical, tableMarkdowns, concepts, tenantPolicy);
}

/**
 * Register a parsed table markdown under its front-matter `id`. Two files claiming the
 * same table is a broken artifact, not something to resolve silently: keeping either
 * one would drop the other's front-matter (including any `sensitive: true`), and
 * authoring tools could pair the table with the file the loader ignores.
 */
function addTableMarkdown(
  tableMarkdowns: Record<string, LoadedTableMarkdown>,
  loaded: LoadedTableMarkdown,
  schemaPath: string,
): void {
  const id = loaded.parsed.frontmatter.id;
  const existing = tableMarkdowns[id];
  if (existing) {
    throw new SchemaParseError(
      `Invalid schema at ${schemaPath}: ${existing.tableFile} and ${loaded.tableFile} both have front-matter id \`${id}\`. Each table needs exactly one markdown file; merge them.`,
    );
  }
  tableMarkdowns[id] = loaded;
}

/**
 * A bundle's `tables` must map each `tables/` file name to its markdown. `askdb bundle`
 * always writes it (`{}` when there are no table files), so anything else is a
 * hand-made or damaged bundle. It's refused rather than loaded without its tables,
 * which would drop every `sensitive: true` they set.
 */
function assertBundledTables(tables: unknown, bundlePath: string): void {
  const dir = SCHEMA_DIRECTORY_FILES.tables;
  if (tables === undefined) {
    throw new SchemaParseError(
      `Invalid bundle at ${bundlePath}: \`${dir}\` is missing; a bundle carries every ${dir}/*.md as an object keyed by file name ({} when there are none).`,
    );
  }
  if (typeof tables !== "object" || tables === null || Array.isArray(tables)) {
    throw new SchemaParseError(
      `Invalid bundle at ${bundlePath}: \`${dir}\` must be an object keyed by ${dir}/*.md file name, with each file's raw markdown as the value.`,
    );
  }
  for (const [filename, content] of Object.entries(tables)) {
    if (typeof content !== "string") {
      throw new SchemaParseError(
        `Invalid bundle at ${bundlePath}: \`${dir}\` entry ${filename} must be the raw ${dir}/${filename} content (a string).`,
      );
    }
  }
}

/** Read an optional bundled markdown file: `undefined` only when the key is absent. */
function bundledFileContent(
  bundle: BundledSchemaV2,
  key: "concepts" | "tenantPolicy",
  bundlePath: string,
): string | undefined {
  const value: unknown = bundle[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new SchemaParseError(
      `Invalid bundle at ${bundlePath}: \`${key}\` must be the raw ${SCHEMA_DIRECTORY_FILES[key]} content (a string).`,
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
    data.version === 1
  ) {
    throw new SchemaParseError(
      `AskDB schema format \`version: 1\` is not supported as of \`@askdb/core@0.2.0\`. ` +
        `Migrate to the schema artifact format (\`"version": 2\`): see https://askdb.tools/reference/schema-artifact-format/.`,
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
  tableMarkdowns: Record<string, LoadedTableMarkdown>,
  concepts: V2ConceptsFrontmatter | undefined,
  tenantPolicy: NormalizedTenantPolicy | undefined,
): NormalizedSchemaV2 {
  const warnings: SchemaV2Warning[] = [];

  // Physical table ids, and each physical column id's owning table, for ID validation
  const physicalTableIds = new Set(physical.tables.map((t) => t.id));
  const columnOwners = columnOwnersOf(physical);

  // Column ids that any front-matter entry marks `sensitive: true`: in the owning
  // table's markdown or another's, first entry or a later duplicate. Sensitivity is the
  // one field aggregated across every entry naming a column, because escalating can
  // only add protection; no entry can cancel another's `sensitive: true`.
  const escalatedColumnIds = new Set<string>();

  // Validate all table markdown IDs against physical layer
  for (const [id, { tableFile, parsed }] of Object.entries(tableMarkdowns)) {
    if (!physicalTableIds.has(id)) {
      warnings.push({ kind: "orphaned_table_id", tableFile, id });
    }
    const seenColumnIds = new Set<string>();
    for (const col of parsed.frontmatter.columns ?? []) {
      // A repeated entry's description/aliases/enum are ignored (the first entry's
      // apply), but its `sensitive: true` still escalates.
      if (seenColumnIds.has(col.id)) {
        warnings.push({ kind: "duplicate_column_id", tableFile, id: col.id });
      }
      seenColumnIds.add(col.id);
      if (col.sensitive === true) escalatedColumnIds.add(col.id);

      const owner = columnOwners.get(col.id);
      if (owner === undefined) {
        warnings.push({ kind: "orphaned_column_id", tableFile, id: col.id });
      } else if (owner !== id) {
        // A column id names exactly one column, so a `sensitive: true` filed under the
        // wrong table's markdown still escalates it: honoring it can only add
        // protection, while dropping it would silently expose a column the author
        // marked sensitive. Nothing else in the entry applies: `sensitive: false` never
        // de-escalates, and description/aliases/enum belong in the owner's own file.
        warnings.push({ kind: "misplaced_column_id", tableFile, id: col.id, tableId: owner });
      }
    }
  }

  const tables: NormalizedV2Table[] = physical.tables.map((physTable) => {
    const loaded = tableMarkdowns[physTable.id];
    const md = loaded?.parsed;
    const tableFile = loaded?.tableFile ?? "";

    // Sensitivity is escalate-only: front-matter `sensitive: true` (written by
    // Studio / @askdb/enrich) marks a table or column sensitive on top of
    // schema.json, but front-matter can never make something *less* sensitive.
    // A `sensitive: false` that contradicts an effective `true` is ignored and
    // reported as a warning so the author sees the override had no effect.
    const tableSensitive = physTable.sensitive === true || md?.frontmatter.sensitive === true;
    if (md?.frontmatter.sensitive === false && tableSensitive) {
      warnings.push({ kind: "sensitivity_downgrade_ignored", tableFile, id: physTable.id });
    }

    const columns: NormalizedV2Column[] = physTable.columns.map((physCol) => {
      const mdCols = md?.frontmatter.columns?.filter((c) => c.id === physCol.id) ?? [];
      const mdCol = mdCols[0];
      const colMarked = physCol.sensitive === true || escalatedColumnIds.has(physCol.id);
      const colSensitive = colMarked || tableSensitive;
      if (colSensitive && mdCols.some((c) => c.sensitive === false)) {
        warnings.push({ kind: "sensitivity_downgrade_ignored", tableFile, id: physCol.id });
      }

      const normalized: NormalizedV2Column = {
        id: physCol.id,
        name: physCol.name,
        type: physCol.type,
        nullable: physCol.nullable,
        primaryKey: physCol.primaryKey ?? false,
        sensitive: colSensitive,
        ...(tableSensitive && !colMarked ? { sensitiveFromTable: true as const } : {}),
      };

      // Describable-layer fields excluded when sensitive
      if (!colSensitive && mdCol) {
        if (mdCol.description !== undefined) normalized.description = mdCol.description;
        if (mdCol.aliases?.length) normalized.aliases = mdCol.aliases;
        if (mdCol.enum?.length) normalized.enum = mdCol.enum;
      }
      const note = colSensitive ? undefined : columnNoteOf(md, physCol.name);
      if (note) normalized.note = note;

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

      const businessContext = md.sections["Business context"]?.trim();
      if (businessContext) normalized.businessContext = businessContext;
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

/**
 * A column's item in its table file's `Column notes` section: a line ``- `column_name`: note``,
 * where `-` or `—` may replace the colon, matched by the column's name (schema v2 contract).
 * `@askdb/rag`'s chunker reads the same items with the same rule.
 */
function columnNoteOf(md: ParsedTableMarkdown | undefined, columnName: string): string | undefined {
  const body = md?.sections["Column notes"];
  if (!body) return undefined;
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (!line.startsWith("-")) continue;
    const match = line.slice(1).trim().match(/^`([^`]+)`\s*[:\-—]\s*(.+)$/);
    if (match && match[1] === columnName) return match[2]!.trim();
  }
  return undefined;
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
