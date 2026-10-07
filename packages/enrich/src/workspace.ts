import { createHash, randomBytes } from "node:crypto";
import {
  accessSync,
  closeSync,
  constants as fsConstants,
  existsSync,
  fchmodSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import {
  parseConceptsMarkdown,
  parseTableMarkdown,
  loadSchema,
  writeConceptsMarkdown,
  writeTableMarkdown,
  v2SchemaJsonSchema,
  type BundledSchemaV2 as CoreBundledSchemaV2,
  type ParsedConceptsMarkdown,
  type ParsedTableMarkdown,
  type SchemaV2Warning,
  type V2Concept,
  type V2ConceptsFrontmatter,
  type V2SchemaJson,
  type V2Table,
  type V2TableFrontmatter,
} from "@askdb/core";

/**
 * One table in the workspace. Pairs the physical layer entry with the (optional)
 * describable-layer markdown file so save knows where to write.
 */
export type WorkspaceTable = {
  /** Physical layer entry from `schema.json`. */
  physical: V2Table;
  /** Path to `tables/<filename>.md` (relative to `tables/`). May not exist on disk yet. */
  filename: string;
  /** Parsed markdown if the file exists; `undefined` for tables without a `.md` yet. */
  parsed: ParsedTableMarkdown | undefined;
  /**
   * IDs of this table's columns that some *other* table markdown file marks
   * `sensitive: true` (a `misplaced_column_id` entry). The core loader honors those
   * escalations, and they are not part of this table's draft, so an authoring UI must
   * treat these columns as sensitive regardless of the draft.
   */
  escalatedByOtherFiles?: string[];
};

export type Workspace = {
  schemaDir: string;
  physical: V2SchemaJson;
  tables: WorkspaceTable[];
  concepts: ParsedConceptsMarkdown | undefined;
  warnings: SchemaV2Warning[];
};

/**
 * The bundle format, re-exported from `@askdb/core`, whose loader defines it.
 *
 * @deprecated Import `BundledSchemaV2` from `@askdb/core` instead.
 */
export type BundledSchemaV2 = CoreBundledSchemaV2;

/**
 * Load a Schema v2 workspace from disk, preserving file-path information for
 * round-trippable save.
 */
export function loadWorkspace(schemaDir: string): Workspace {
  const schemaJsonPath = join(schemaDir, "schema.json");
  if (!existsSync(schemaJsonPath)) {
    throw new Error(`No schema.json found in ${schemaDir}`);
  }

  const physical = parsePhysical(readFileSync(schemaJsonPath, "utf8"), schemaJsonPath);

  const tableDir = join(schemaDir, "tables");
  const parsedByFile = new Map<string, ParsedTableMarkdown>();
  // Every name in tables/, not only the `.md` files the loader reads: a default
  // filename must not land on any of them (`Orders.MD` is `orders.md` on APFS).
  const entriesOnDisk = existsSync(tableDir) ? readdirSync(tableDir) : [];
  if (existsSync(tableDir)) {
    for (const entry of entriesOnDisk) {
      if (!entry.endsWith(".md")) continue;
      const content = readFileSync(join(tableDir, entry), "utf8");
      parsedByFile.set(entry, parseTableMarkdown(content, join(tableDir, entry)));
    }
  }

  // Column escalations filed in a file other than the owning table's (the loader's
  // `misplaced_column_id` entries), keyed by owning table id.
  const columnOwner = new Map(
    physical.tables.flatMap((t) => t.columns.map((c) => [c.id, t.id] as const)),
  );
  const escalatedByOtherFiles = new Map<string, Set<string>>();
  for (const parsed of parsedByFile.values()) {
    for (const col of parsed.frontmatter.columns ?? []) {
      const owner = columnOwner.get(col.id);
      if (col.sensitive !== true || owner === undefined || owner === parsed.frontmatter.id) continue;
      const set = escalatedByOtherFiles.get(owner) ?? new Set<string>();
      set.add(col.id);
      escalatedByOtherFiles.set(owner, set);
    }
  }

  // Pair physical tables with their .md (if any), matched by front-matter id —
  // existing files keep their filename whatever it is. Physical tables without
  // a .md get a safe, collision-free default filename.
  const matchedByTableId = new Map<string, [string, ParsedTableMarkdown]>();
  for (const physTable of physical.tables) {
    const matched = [...parsedByFile.entries()].find(
      ([, p]) => p.frontmatter.id === physTable.id,
    );
    if (matched) matchedByTableId.set(physTable.id, matched);
  }
  const defaultFilenames = assignDefaultTableFilenames(
    physical.tables.filter((t) => !matchedByTableId.has(t.id)),
    physical.tables,
    entriesOnDisk,
  );
  const tables: WorkspaceTable[] = physical.tables.map((physTable) => {
    const matched = matchedByTableId.get(physTable.id);
    const escalated = [...(escalatedByOtherFiles.get(physTable.id) ?? [])];
    if (matched) {
      return { physical: physTable, filename: matched[0], parsed: matched[1], escalatedByOtherFiles: escalated };
    }
    return {
      physical: physTable,
      filename: defaultFilenames.get(physTable.id)!,
      parsed: undefined,
      escalatedByOtherFiles: escalated,
    };
  });

  let concepts: ParsedConceptsMarkdown | undefined;
  const conceptsPath = join(schemaDir, "concepts.md");
  if (existsSync(conceptsPath)) {
    concepts = parseConceptsMarkdown(readFileSync(conceptsPath, "utf8"), conceptsPath);
  }

  return {
    schemaDir,
    physical,
    tables,
    concepts,
    warnings: [...loadSchema(schemaDir).warnings, ...computeMissingDescribableWarnings(tables)],
  };
}

/**
 * Save a table's frontmatter + body back to disk via the Phase 5 writer.
 * If the `.md` file does not exist, it is created with a minimal body skeleton.
 */
export function saveTable(
  workspace: Workspace,
  tableId: string,
  frontmatter: V2TableFrontmatter,
  body: string,
): void {
  const wt = workspace.tables.find((t) => t.physical.id === tableId);
  if (!wt) throw new Error(`No such table: ${tableId}`);
  const tablesDir = join(workspace.schemaDir, "tables");
  const filePath = resolveTableFilePath(tablesDir, wt.filename);
  mkdirSync(tablesDir, { recursive: true });
  const md = writeTableMarkdown(frontmatter, body);
  replaceTableFile(tablesDir, filePath, wt.filename, md);
  // Update in-memory parse so subsequent edits see the saved state.
  const reparsed = parseTableMarkdown(md, filePath);
  wt.parsed = reparsed;
}

/** Save concepts.md back to disk via the Phase 5 writer. */
export function saveConcepts(
  workspace: Workspace,
  frontmatter: V2ConceptsFrontmatter,
  body = workspace.concepts?.body ?? "# Concepts\n\nCross-table vocabulary.\n",
): void {
  const invalid = validateConceptLinks(workspace, frontmatter.concepts);
  if (invalid.length > 0) {
    throw new Error(`Invalid concept link(s): ${invalid.join(", ")}`);
  }
  const filePath = join(workspace.schemaDir, "concepts.md");
  const md = writeConceptsMarkdown(frontmatter, body);
  writeFileSync(filePath, md, "utf8");
  workspace.concepts = parseConceptsMarkdown(md, filePath);
}

export function validateConceptLinks(workspace: Workspace, concepts: V2Concept[]): string[] {
  const known = new Set<string>();
  for (const table of workspace.physical.tables) {
    known.add(table.id);
    for (const column of table.columns) known.add(column.id);
  }
  return concepts.flatMap((concept) => concept.links ?? []).filter((link) => !known.has(link));
}

export function pruneOrphanedColumns(workspace: Workspace): number {
  const physicalColumnIds = new Set(
    workspace.physical.tables.flatMap((table) => table.columns.map((column) => column.id)),
  );
  let pruned = 0;

  for (const table of workspace.tables) {
    const parsed = table.parsed;
    if (!parsed?.frontmatter.columns) continue;
    const nextColumns = parsed.frontmatter.columns.filter((column) => {
      const keep = physicalColumnIds.has(column.id);
      if (!keep) pruned += 1;
      return keep;
    });
    if (nextColumns.length === parsed.frontmatter.columns.length) continue;
    const nextFrontmatter = {
      ...parsed.frontmatter,
      columns: nextColumns.length > 0 ? nextColumns : undefined,
    };
    saveTable(workspace, table.physical.id, nextFrontmatter, parsed.body);
  }

  workspace.warnings = [
    ...loadSchema(workspace.schemaDir).warnings,
    ...computeMissingDescribableWarnings(workspace.tables),
  ];
  return pruned;
}

function computeMissingDescribableWarnings(tables: WorkspaceTable[]): SchemaV2Warning[] {
  const warnings: SchemaV2Warning[] = [];
  for (const table of tables) {
    if (!table.parsed) {
      warnings.push({ kind: "missing_table_md", tableId: table.physical.id });
      continue;
    }
    const described = new Set((table.parsed.frontmatter.columns ?? []).map((column) => column.id));
    for (const column of table.physical.columns) {
      if (!described.has(column.id)) {
        warnings.push({
          kind: "missing_column_md",
          tableId: table.physical.id,
          columnId: column.id,
        });
      }
    }
  }
  return warnings;
}

function parsePhysical(raw: string, filePath: string): V2SchemaJson {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Failed to parse JSON at ${filePath}`);
  }
  const result = v2SchemaJsonSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Invalid schema.json at ${filePath}: ${result.error.message}`);
  }
  return result.data;
}

export function bundleSchemaDirectory(schemaDir: string): CoreBundledSchemaV2 {
  const schemaJsonPath = join(schemaDir, "schema.json");
  if (!existsSync(schemaJsonPath)) {
    throw new Error(`No schema.json found in ${schemaDir}`);
  }
  const physical = parsePhysical(readFileSync(schemaJsonPath, "utf8"), schemaJsonPath);
  const tables: Record<string, string> = {};
  const tableDir = join(schemaDir, "tables");
  if (existsSync(tableDir)) {
    for (const entry of readdirSync(tableDir).sort()) {
      if (!entry.endsWith(".md")) continue;
      tables[entry] = readFileSync(join(tableDir, entry), "utf8");
    }
  }
  const bundle: CoreBundledSchemaV2 = { bundled: true, physical, tables };
  for (const [key, file] of Object.entries(OPTIONAL_BUNDLE_FILES) as [OptionalBundleKey, string][]) {
    const content = readOptionalFile(join(schemaDir, file));
    if (content !== undefined) bundle[key] = content;
  }
  return bundle;
}

type OptionalBundleKey = Exclude<keyof CoreBundledSchemaV2, "bundled" | "physical" | "tables">;

/**
 * Each optional bundle field and the schema-directory file it carries. Typed
 * against core's `BundledSchemaV2`, so a field the loader starts reading fails
 * this build until the bundler writes it too.
 */
const OPTIONAL_BUNDLE_FILES: Record<OptionalBundleKey, string> = {
  concepts: "concepts.md",
  tenantPolicy: "tenant-policy.md",
};

function readOptionalFile(filePath: string): string | undefined {
  return existsSync(filePath) ? readFileSync(filePath, "utf8") : undefined;
}

/**
 * Turn a database identifier into a filename-safe slug. Path separators, NUL,
 * control characters, and characters reserved on Windows become `_`; names
 * that would be hidden files (including `.` / `..`) or Windows device names
 * get a `_` prefix; trailing dots and spaces (which Windows strips) become `_`.
 * Everything else, including non-ASCII letters, is kept so ordinary names
 * stay readable.
 */
function toSafeFilenameSlug(identifier: string): string {
  let slug = identifier.replace(/[\u0000-\u001f\u007f/\\<>:"|?*]/g, "_");
  slug = slug.replace(/[. ]+$/, (m) => "_".repeat(m.length));
  if (slug === "") return "_";
  if (slug.startsWith(".")) slug = `_${slug}`;
  if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\.|$)/i.test(slug)) slug = `_${slug}`;
  return slug;
}

/**
 * The key under which two names are the same file on a case-insensitive file
 * system. APFS ignores Unicode normalization and compares with full case folding
 * (`straße` = `STRASSE` = `STRAẞE`, NFC `café` = NFD `café`); NTFS compares with a
 * per-character uppercase table and no normalization. NFC removes normalization
 * differences; lowercasing first maps capital sharp s `ẞ` to `ß`, and the uppercase
 * step then expands `ß` to `SS`, so the key agrees with full case folding (ADR 0013
 * records how that was checked). Over-matching only costs a longer filename.
 */
function filenameKey(name: string): string {
  return name.normalize("NFC").toLowerCase().toUpperCase().toLowerCase();
}

/**
 * Longest default filename, counted in UTF-8 bytes of its decomposed (NFD) form.
 * That count is at least the length every common file system limits: UTF-8 bytes
 * (ext4, APFS: 255), UTF-16 units (NTFS: 255), and decomposed UTF-16 units (HFS+:
 * 255). The margin under 255 leaves room for editor and atomic-write temp names
 * such as `.orders.md.swp`.
 */
const MAX_FILENAME_BYTES = 200;

const nfdByteLength = (s: string): number => Buffer.byteLength(s.normalize("NFD"), "utf8");

/**
 * `<stem>.md`, or, when that is longer than `MAX_FILENAME_BYTES`, the longest
 * whole-code-point prefix of `stem` that fits, then `~<8 hex chars of
 * sha256(stem)>.md`. The hash keeps two long names that share a prefix apart.
 */
function fitFilename(stem: string): string {
  const filename = `${stem}.md`;
  if (nfdByteLength(filename) <= MAX_FILENAME_BYTES) return filename;
  const suffix = `~${createHash("sha256").update(stem).digest("hex").slice(0, 8)}.md`;
  let budget = MAX_FILENAME_BYTES - suffix.length;
  let prefix = "";
  for (const ch of stem) {
    budget -= nfdByteLength(ch);
    if (budget < 0) break;
    prefix += ch;
  }
  return `${prefix}${suffix}`;
}

/**
 * Pick default `tables/` filenames for tables that do not have a markdown file
 * yet (ADR 0013). Uses `<name>.md` when the bare name is unique across the
 * physical layer, otherwise the schema-qualified `<schema>.<name>.md`, comparing
 * names as a case-insensitive file system would (`filenameKey`). Never reuses a
 * filename already on disk or already assigned; falls back to a numeric suffix
 * if needed. Over-long names are shortened with a hash suffix (`fitFilename`).
 */
function assignDefaultTableFilenames(
  unassigned: V2Table[],
  allTables: V2Table[],
  existingFilenames: string[],
): Map<string, string> {
  const bareNameCounts = new Map<string, number>();
  for (const t of allTables) {
    const key = filenameKey(toSafeFilenameSlug(t.name));
    bareNameCounts.set(key, (bareNameCounts.get(key) ?? 0) + 1);
  }
  const taken = new Set(existingFilenames.map(filenameKey));
  const assigned = new Map<string, string>();
  for (const t of unassigned) {
    const bare = toSafeFilenameSlug(t.name);
    const qualified = toSafeFilenameSlug(`${t.schema}.${t.name}`);
    const nameCollides = (bareNameCounts.get(filenameKey(bare)) ?? 0) > 1;
    let filename = fitFilename(nameCollides ? qualified : bare);
    if (taken.has(filenameKey(filename))) filename = fitFilename(qualified);
    for (let n = 2; taken.has(filenameKey(filename)); n += 1) {
      filename = fitFilename(`${qualified}-${n}`);
    }
    taken.add(filenameKey(filename));
    assigned.set(t.id, filename);
  }
  return assigned;
}

/**
 * Resolve a workspace table filename to an absolute path, refusing anything
 * that would land outside `tablesDir` (path separators, `..`, absolute paths,
 * NUL bytes) or is not a `.md` file.
 */
function resolveTableFilePath(tablesDir: string, filename: string): string {
  const root = resolve(tablesDir);
  const filePath = resolve(root, filename);
  if (
    filename.includes("\0") ||
    filename.includes("/") ||
    filename.includes("\\") ||
    basename(filePath) !== filename ||
    dirname(filePath) !== root ||
    !filename.endsWith(".md")
  ) {
    throw new Error(
      `Refusing to write table markdown outside tables/: ${JSON.stringify(filename)}`,
    );
  }
  return filePath;
}

/**
 * Write a table markdown file so that no link can redirect the write out of
 * `tables/`. A schema directory can come from an untrusted checkout (git stores
 * symbolic links, tar archives also store hard links), and Studio saves into it
 * for as long as it runs.
 *
 * - `tables/` itself and the target file must not be symbolic links; either one
 *   is refused.
 * - The content goes to a new temp file in `tables/` (`O_EXCL`, so it never opens
 *   an existing path), which is then renamed over the target. `rename` replaces
 *   the directory entry instead of writing into the existing file, so a hard link
 *   to a file elsewhere is detached, not written through, and a symbolic link
 *   planted at the target after the check is replaced, not followed. This holds on
 *   Windows too, which has no `O_NOFOLLOW`.
 * - A target the caller can't write is refused with `EACCES`, as a plain write
 *   would be. `rename` needs only write access to `tables/`, so without this check
 *   a read-only file (how Perforce and ClearCase mark files not checked out) would
 *   be replaced on macOS and Linux.
 * - The temp file gets the target's permission bits before any content is written,
 *   so a `0600` file's new content is never readable by others, and it is
 *   `fsync`ed before the rename. Readers, and a crash or power loss, see either the
 *   old file or the new one, never a partial write.
 *
 * Not covered: `tables/` being swapped for a link after the check and before the
 * rename, since the temp path and the rename still resolve through it. That needs
 * a concurrent local writer racing a save.
 */
function replaceTableFile(
  tablesDir: string,
  filePath: string,
  filename: string,
  content: string,
): void {
  const refuse = (why: string) =>
    new Error(`Refusing to write table markdown outside tables/: ${why}`);
  if (lstatSync(tablesDir).isSymbolicLink()) throw refuse("tables/ is a symbolic link");
  const existing = lstatSync(filePath, { throwIfNoEntry: false });
  if (existing?.isSymbolicLink()) throw refuse(`${JSON.stringify(filename)} is a symbolic link`);
  if (existing) accessSync(filePath, fsConstants.W_OK);

  const tempPath = join(tablesDir, `.askdb-save-${randomBytes(8).toString("hex")}.tmp`);
  const fd = openSync(
    tempPath,
    fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL,
    0o666,
  );
  try {
    try {
      // Keep the replaced file's permission bits, before the content lands.
      if (existing) fchmodSync(fd, existing.mode & 0o777);
      writeFileSync(fd, content, "utf8");
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tempPath, filePath);
  } catch (e) {
    try {
      rmSync(tempPath, { force: true });
    } catch {
      // Report the save's own error, not a failed cleanup (e.g. Windows EPERM).
    }
    throw e;
  }
}

/**
 * Build a default body skeleton for a brand-new table .md file:
 * `# Table: <name>` heading + the description as the first paragraph.
 */
export function buildDefaultTableBody(name: string, description: string): string {
  const desc = description.trim();
  const head = `# Table: ${name}\n`;
  if (!desc) return `${head}\n`;
  return `${head}\n${desc}\n`;
}

/**
 * Replace the description (first paragraph after the H1) in a table markdown body,
 * preserving the H1 line and all subsequent H2 sections verbatim.
 *
 * The result has exactly one blank line between H1 and the description, and exactly
 * one blank line between the description and whatever follows.
 */
export function replaceTableDescription(body: string, newDescription: string): string {
  const trimmed = newDescription.trim();
  const lines = body.split("\n");

  const h1Idx = lines.findIndex((l) => l.startsWith("# "));
  // Where description content starts: the first non-blank line after H1
  // (or the first non-blank line in the body if there is no H1).
  let descStart = h1Idx >= 0 ? h1Idx + 1 : 0;
  while (descStart < lines.length && lines[descStart]!.trim() === "") {
    descStart += 1;
  }

  // Where description content ends: the first blank line or H1/H2 we hit.
  let descEnd = descStart;
  while (
    descEnd < lines.length &&
    lines[descEnd]!.trim() !== "" &&
    !lines[descEnd]!.startsWith("# ") &&
    !lines[descEnd]!.startsWith("## ")
  ) {
    descEnd += 1;
  }

  const before = h1Idx >= 0 ? lines.slice(0, h1Idx + 1) : [];
  // Drop trailing blanks at the end of `before` so we control spacing exactly.
  while (before.length > 0 && before[before.length - 1]!.trim() === "") {
    before.pop();
  }

  const after = lines.slice(descEnd);
  // Drop leading blanks from `after` so we control spacing exactly.
  while (after.length > 0 && after[0]!.trim() === "") {
    after.shift();
  }

  const segments: string[] = [];
  if (before.length > 0) {
    segments.push(...before);
    if (trimmed || after.length > 0) segments.push("");
  }
  if (trimmed) {
    segments.push(trimmed);
    if (after.length > 0) segments.push("");
  }
  segments.push(...after);

  // Preserve a trailing newline if the original had one.
  const trailingNewline = body.endsWith("\n");
  const out = segments.join("\n");
  return trailingNewline && !out.endsWith("\n") ? `${out}\n` : out;
}

/**
 * Replace or append a recognized H2 section body without touching the rest of
 * the markdown body. The section content is normalized to one blank line after
 * the heading and a trailing newline before the next section.
 */
export function replaceH2Section(body: string, heading: string, content: string): string {
  const normalized = normalizeSection(heading, content);
  const pattern = new RegExp(`^## ${escapeRegex(heading)}\\s*$`, "im");
  const match = pattern.exec(body);
  if (!match) {
    const base = body.endsWith("\n") ? body : `${body}\n`;
    return `${base}\n${normalized}`;
  }

  const start = match.index;
  const afterHeading = start + match[0].length;
  const rest = body.slice(afterHeading);
  const nextMatch = /^## .+$/m.exec(rest);
  const end = nextMatch ? afterHeading + nextMatch.index : body.length;
  const before = body.slice(0, start).replace(/\s*$/, "\n\n");
  const after = body.slice(end).replace(/^\s*/, "");
  return after ? `${before}${normalized}\n${after}` : `${before}${normalized}`;
}

function normalizeSection(heading: string, content: string): string {
  const trimmed = content.trim();
  return trimmed ? `## ${heading}\n\n${trimmed}\n` : `## ${heading}\n`;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
