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

/**
 * Compiles the "mentions a sensitive column by name" rule of the schema v2
 * contract (`docs/contracts/schema-v2.md`, Sensitive propagation) for
 * `names`. Build one per name list and reuse it: `@askdb/rag`'s chunker
 * checks every describable text of a schema against the same list.
 */
export function createMentionMatcher(names: readonly MentionName[]): MentionMatcher {
  const entries = names
    .filter((name) => (typeof name === "string" ? name !== "" : name.table !== "" && name.column !== ""))
    .map((name) => ({ name, source: namePattern(name) }));
  const each = entries.map(({ name, source }) => ({ name, pattern: new RegExp(`${BEFORE}${source}${AFTER}`, "iu") }));
  const any =
    entries.length === 0
      ? undefined
      : new RegExp(`${BEFORE}(?:${entries.map((e) => e.source).join("|")})${AFTER}`, "iu");
  return {
    mentionsAny: (text) => Boolean(text) && any !== undefined && any.test(text),
    find: (text) => (text ? each.filter(({ pattern }) => pattern.test(text)).map(({ name }) => name) : []),
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

/** A bare name, or a qualified one's table and column parts: as written, or wrapped in one matching pair of quotes or brackets. */
function partPattern(part: string): string {
  const p = escapeRegex(part);
  return `(?:"${p}"|\`${p}\`|\\[${p}\\]|${p})`;
}

function namePattern(name: MentionName): string {
  if (typeof name === "string") return partPattern(name);
  // A tight dot, or spaces or tabs on both sides: "users. Org_id" ends a sentence.
  return `${partPattern(name.table)}(?:\\.|[ \\t]+\\.[ \\t]+)${partPattern(name.column)}`;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
