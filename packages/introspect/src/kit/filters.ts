import type { IntrospectionWarning } from "../types.js";

/**
 * Minimal glob matcher for `IntrospectionFilters.tables`. Patterns match
 * against `"<schema>.<name>"` strings; supported wildcards:
 *
 *   *   matches any run of characters (including dots)
 *   ?   matches a single character
 *
 * Brace expansion (`{a,b}`) and character classes (`[abc]`) are intentionally
 * not supported — keeping the surface small avoids a glob dependency. If a
 * filter looks valid but matches nothing, emit an `ambiguous_filter` warning
 * (see {@link ambiguousFilterWarnings}).
 */
export function compileGlob(pattern: string): RegExp {
  let out = "^";
  for (const ch of pattern) {
    if (ch === "*") out += ".*";
    else if (ch === "?") out += ".";
    else if (/[.+^${}()|[\]\\]/.test(ch)) out += "\\" + ch;
    else out += ch;
  }
  out += "$";
  return new RegExp(out);
}

export type GlobMatcher = (qualifiedName: string) => boolean;

/**
 * Returns a matcher that accepts a `"<schema>.<name>"` and returns true when
 * any pattern matches. When `patterns` is empty or undefined, the matcher
 * always returns true (no filtering).
 */
export function compileTableFilters(patterns: ReadonlyArray<string> | undefined): GlobMatcher {
  if (!patterns || patterns.length === 0) return () => true;
  const compiled = patterns.map(compileGlob);
  return (qualifiedName) => compiled.some((re) => re.test(qualifiedName));
}

/**
 * One `ambiguous_filter` warning per declared `tables` pattern that matches
 * none of the emitted objects. `qualifiedNames` are the `"<schema>.<name>"` of
 * every table and view that made it into the result. Warnings keep the
 * declared pattern order (duplicates included).
 */
export function ambiguousFilterWarnings(
  patterns: ReadonlyArray<string> | undefined,
  qualifiedNames: Iterable<string>,
): IntrospectionWarning[] {
  if (!patterns || patterns.length === 0) return [];
  const names = [...qualifiedNames];
  const warnings: IntrospectionWarning[] = [];
  for (const pattern of patterns) {
    const re = compileGlob(pattern);
    if (!names.some((name) => re.test(name))) {
      warnings.push({ code: "ambiguous_filter", filter: pattern });
    }
  }
  return warnings;
}
