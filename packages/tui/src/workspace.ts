import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseConceptsMarkdown,
  parseTableMarkdown,
  loadSchema,
  writeConceptsMarkdown,
  writeTableMarkdown,
  v2SchemaJsonSchema,
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
};

export type Workspace = {
  schemaDir: string;
  physical: V2SchemaJson;
  tables: WorkspaceTable[];
  concepts: ParsedConceptsMarkdown | undefined;
  warnings: SchemaV2Warning[];
};

export type BundledSchemaV2 = {
  bundled: true;
  physical: V2SchemaJson;
  tables: Record<string, string>;
  concepts?: string;
};

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
  if (existsSync(tableDir)) {
    for (const entry of readdirSync(tableDir)) {
      if (!entry.endsWith(".md")) continue;
      const content = readFileSync(join(tableDir, entry), "utf8");
      parsedByFile.set(entry, parseTableMarkdown(content, join(tableDir, entry)));
    }
  }

  // Pair physical tables with their .md (if any). New physical tables get a
  // default filename derived from the table name.
  const tables: WorkspaceTable[] = physical.tables.map((physTable) => {
    const matched = [...parsedByFile.entries()].find(
      ([, p]) => p.frontmatter.id === physTable.id,
    );
    if (matched) {
      return { physical: physTable, filename: matched[0], parsed: matched[1] };
    }
    return { physical: physTable, filename: `${physTable.name}.md`, parsed: undefined };
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
  const filePath = join(tablesDir, wt.filename);
  const md = writeTableMarkdown(frontmatter, body);
  writeFileSync(filePath, md, "utf8");
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

export function bundleSchemaDirectory(schemaDir: string): BundledSchemaV2 {
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
  const conceptsPath = join(schemaDir, "concepts.md");
  const concepts = existsSync(conceptsPath)
    ? readFileSync(conceptsPath, "utf8")
    : undefined;
  return {
    bundled: true,
    physical,
    tables,
    ...(concepts !== undefined ? { concepts } : {}),
  };
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
