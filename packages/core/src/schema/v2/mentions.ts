import type { NormalizedSchemaV2 } from "./normalized.js";

/**
 * A name to look for in text: a bare name (matched literally, dots included),
 * or a column qualified by its table.
 */
export type MentionName = string | { table: string; column: string };

/** Matches one list of names against many texts, compiling the patterns once. */
export type MentionMatcher = {
  /** Whether `text` mentions any of the names (a single regex test). */
  mentionsAny(text: string): boolean;
  /** The names `text` mentions, in the order given. */
  find(text: string): MentionName[];
};

// A match's ends may not touch a letter, digit, or `_` of any script.
const BEFORE = "(?<![\\p{L}\\p{N}_])";
const AFTER = "(?![\\p{L}\\p{N}_])";
// Between a qualified name's table and column: a tight dot, or spaces or tabs
// on both sides ("users. Org_id" ends a sentence).
const QUALIFIER = "(?:\\.|[ \\t]+\\.[ \\t]+)";

/**
 * Compiles the "mentions a sensitive column by name" rule of the schema v2
 * contract (`docs/contracts/schema-v2.md`, Sensitive propagation) for
 * `names`. Build one per name list and reuse it: `@askdb/rag`'s chunker
 * checks every describable text of a schema against the same list.
 */
export function createMentionMatcher(names: readonly MentionName[]): MentionMatcher {
  const entries = names.filter((name) =>
    typeof name === "string" ? name !== "" : name.table !== "" && name.column !== "",
  );
  // One alternative per bare name, and one per table for its qualified names
  // (`table` + separator + any of its columns): the same matches as one
  // alternative per name, without trying every column of every sensitive
  // table at each position of the text.
  const alternatives: string[] = [];
  const columnsByTable = new Map<string, string[]>();
  for (const name of entries) {
    if (typeof name === "string") alternatives.push(partPattern(name));
    else {
      const columns = columnsByTable.get(name.table) ?? [];
      columns.push(partPattern(name.column));
      columnsByTable.set(name.table, columns);
    }
  }
  for (const [table, columns] of columnsByTable) {
    alternatives.push(`${partPattern(table)}${QUALIFIER}(?:${columns.join("|")})`);
  }
  const any =
    alternatives.length === 0 ? undefined : new RegExp(`${BEFORE}(?:${alternatives.join("|")})${AFTER}`, "iu");
  // Compiled on the first `find`: the prompt builders only ask `mentionsAny`.
  let each: { name: MentionName; pattern: RegExp }[] | undefined;
  const patterns = () =>
    (each ??= entries.map((name) => ({ name, pattern: new RegExp(`${BEFORE}${namePattern(name)}${AFTER}`, "iu") })));
  return {
    mentionsAny: (text) => Boolean(text) && any !== undefined && any.test(text),
    find: (text) => (text ? patterns().filter(({ pattern }) => pattern.test(text)).map(({ name }) => name) : []),
  };
}

/**
 * The names `text` mentions, in `names` order, by the schema v2 contract's
 * mention rule (see {@link createMentionMatcher}). `@askdb/rag`'s chunker and
 * `@askdb/enrich`'s authoring warning both use this rule, so they can't
 * disagree on what a mention is. Compiles `names` on every call; to check
 * many texts against one list, build a matcher once instead.
 */
export function findMentionedNames<T extends MentionName>(text: string, names: readonly T[]): T[] {
  return createMentionMatcher(names).find(text) as T[];
}

/**
 * The names whose mention marks text as naming a sensitive column, for the
 * whole schema (ADR 0017; how they match is the schema v2 contract's mention
 * rule). A column marked sensitive itself counts by its bare name; a column
 * of a sensitive table that is sensitive only through it
 * (`sensitiveFromTable`) counts only qualified, since its bare name is often
 * generic (`id`, `org_id`, `name`). Untracked tables' columns count too.
 * `@askdb/rag`'s chunker and both NL→SQL prompt builders check describable
 * text against this list.
 */
export function sensitiveMentionNames(schema: NormalizedSchemaV2): MentionName[] {
  const names: MentionName[] = [];
  const bare = new Set<string>();
  for (const t of schema.tables) {
    for (const c of t.columns) {
      if (!c.sensitive && !t.sensitive) continue;
      if (t.sensitive && c.sensitiveFromTable === true) {
        names.push({ table: t.name, column: c.name });
      } else if (!bare.has(c.name)) {
        bare.add(c.name);
        names.push(c.name);
      }
    }
  }
  return names;
}

/** A bare name, or a qualified one's table and column parts: as written, or wrapped in one matching pair of quotes or brackets. */
function partPattern(part: string): string {
  const p = escapeRegex(part);
  return `(?:"${p}"|\`${p}\`|\\[${p}\\]|${p})`;
}

function namePattern(name: MentionName): string {
  if (typeof name === "string") return partPattern(name);
  return `${partPattern(name.table)}${QUALIFIER}${partPattern(name.column)}`;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
