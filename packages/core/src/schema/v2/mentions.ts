/**
 * The names `text` mentions, in `names` order: a whole-word, case-insensitive
 * match. A match's ends must not touch a letter, digit, or `_` of any script,
 * so `email` isn't mentioned by `emailed` and `café` isn't by `cafés`, while
 * a name wrapped in backticks or quotes still is. Names may hold any
 * characters (`ssn$`). A qualified name (`users.org_id`) also matches with a
 * schema prefix, with each part quoted or bracketed (`"users"."org_id"`,
 * `[users].[org_id]`, `` `users`.`org_id` ``), and with spaces around a dot.
 *
 * This is the one rule for "mentions a sensitive column by name" in the
 * schema v2 contract: `@askdb/rag`'s chunker and `@askdb/enrich`'s authoring
 * warning both call it, so they can't disagree on what a mention is.
 */
export function findMentionedNames(text: string, names: readonly string[]): string[] {
  if (!text) return [];
  return names.filter((name) => {
    if (!name) return false;
    const body = name
      .split(".")
      .map((part) => `[\`"\\[]?${escapeRegex(part)}[\`"\\]]?`)
      .join("\\s*\\.\\s*");
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}_])${body}(?![\\p{L}\\p{N}_])`, "iu");
    return pattern.test(text);
  });
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
