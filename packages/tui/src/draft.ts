import type {
  ParsedTableMarkdown,
  V2Column,
  V2ColumnFrontmatter,
  V2Table,
  V2TableFrontmatter,
} from "@askdb/core";

/**
 * In-memory editable representation of a single table's describable layer.
 * Built from the parsed markdown when present; defaulted when not.
 */
export type ColumnDraft = {
  description?: string;
  aliases?: string[];
  enum?: string[];
  sensitive?: boolean;
};

export type TableDraft = {
  description: string;
  aliases?: string[];
  primaryEntity?: string;
  tags?: string[];
  /** Override (only set when user explicitly toggles). */
  sensitive?: boolean;
  /** Verbatim content under `## Common query language`. */
  commonQueryLanguage?: string;
  /** Verbatim content under `## Example questions`. */
  exampleQuestions?: string;
  /** Per-column drafts keyed by column id. */
  columns: Record<string, ColumnDraft>;
};

export function buildTableDraft(
  physical: V2Table,
  parsed: ParsedTableMarkdown | undefined,
): TableDraft {
  const fm = parsed?.frontmatter;
  const columns: Record<string, ColumnDraft> = {};
  for (const col of physical.columns) {
    const fmCol = fm?.columns?.find((c) => c.id === col.id);
    const draft: ColumnDraft = {};
    if (fmCol?.description !== undefined) draft.description = fmCol.description;
    if (fmCol?.aliases !== undefined) draft.aliases = [...fmCol.aliases];
    if (fmCol?.enum !== undefined) draft.enum = [...fmCol.enum];
    if (fmCol?.sensitive !== undefined) draft.sensitive = fmCol.sensitive;
    columns[col.id] = draft;
  }

  return {
    description: parsed ? extractFirstParagraph(parsed.body) ?? "" : "",
    aliases: fm?.aliases ? [...fm.aliases] : undefined,
    primaryEntity: fm?.primaryEntity,
    tags: fm?.tags ? [...fm.tags] : undefined,
    sensitive: fm?.sensitive,
    commonQueryLanguage: parsed?.sections["Common query language"],
    exampleQuestions: parsed?.sections["Example questions"],
    columns,
  };
}

/**
 * Build the V2TableFrontmatter to write to disk from a draft + physical.
 * Empty optional fields are omitted entirely (cleaner round-trip).
 */
export function buildFrontmatter(
  physical: V2Table,
  schemaId: string,
  draft: TableDraft,
): V2TableFrontmatter {
  const columns: V2ColumnFrontmatter[] = physical.columns.map((col) => {
    const c = draft.columns[col.id] ?? {};
    const out: V2ColumnFrontmatter = { id: col.id };
    if (nonEmptyStrings(c.aliases)) out.aliases = c.aliases;
    if (nonEmptyStrings(c.enum)) out.enum = c.enum;
    if (c.description !== undefined && c.description !== "") {
      out.description = c.description;
    }
    if (c.sensitive !== undefined) out.sensitive = c.sensitive;
    return out;
  });

  const fm: V2TableFrontmatter = {
    id: physical.id,
    name: physical.name,
    schemaId,
  };
  if (draft.primaryEntity) fm.primaryEntity = draft.primaryEntity;
  if (nonEmptyStrings(draft.aliases)) fm.aliases = draft.aliases;
  if (nonEmptyStrings(draft.tags)) fm.tags = draft.tags;
  if (draft.sensitive !== undefined) fm.sensitive = draft.sensitive;
  // Only emit columns array when at least one column has describable content,
  // so "untouched" tables stay minimal.
  if (columns.some((c) => Object.keys(c).length > 1)) fm.columns = columns;
  return fm;
}

/** Parse a comma-separated string into a trimmed list (empty entries dropped). */
export function parseListInput(input: string): string[] {
  return input
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function formatList(list: string[] | undefined): string {
  return list ? list.join(", ") : "";
}

/** Sensitive column names (per physical layer) referenced in a description. */
export function findSensitiveColumnReferences(
  description: string,
  physical: V2Table,
): string[] {
  const lower = description.toLowerCase();
  return physical.columns
    .filter((c) => c.sensitive)
    .map((c) => c.name)
    .filter((name) => {
      const re = new RegExp(`\\b${escapeRegex(name)}\\b`, "i");
      return re.test(lower);
    });
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function nonEmptyStrings(list: string[] | undefined): list is string[] {
  return Array.isArray(list) && list.length > 0;
}

function extractFirstParagraph(body: string): string | undefined {
  const lines = body.split("\n");
  const out: string[] = [];
  let inParagraph = false;
  let seenHeading = false;
  for (const line of lines) {
    if (line.startsWith("#")) {
      if (seenHeading) break;
      seenHeading = true;
      continue;
    }
    if (line.trim() === "") {
      if (inParagraph) break;
      continue;
    }
    inParagraph = true;
    out.push(line.trim());
  }
  return out.length > 0 ? out.join(" ") : undefined;
}

/** Are any per-column describable fields populated? */
export function hasAnyColumnDescribable(draft: TableDraft): boolean {
  return Object.values(draft.columns).some(
    (c) =>
      (c.description !== undefined && c.description !== "") ||
      (c.aliases && c.aliases.length > 0) ||
      (c.enum && c.enum.length > 0) ||
      c.sensitive !== undefined,
  );
}

/** Is the column type a candidate for an enum field? (text-y types). */
export function isEnumCandidate(col: V2Column): boolean {
  const t = col.type.toLowerCase();
  return (
    t === "text" ||
    t.startsWith("varchar") ||
    t.startsWith("char") ||
    t === "citext" ||
    t.endsWith("[]") === false && t.includes("enum")
  );
}
