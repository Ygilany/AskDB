/**
 * Minimal glob matcher for `IntrospectionFilters.tables`. The filter matches
 * against `"<schema>.<name>"` strings; supported wildcards:
 *
 *   *   matches any run of characters (including dots)
 *   ?   matches a single character
 *
 * Brace expansion (`{a,b}`) and character classes (`[abc]`) are intentionally
 * not supported — keeping the surface small avoids a glob dependency. If a
 * filter looks valid but matches nothing, the caller emits an
 * `ambiguous_filter` warning.
 */
function compileGlob(pattern: string): RegExp {
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
export function compileTableFilters(
  patterns: ReadonlyArray<string> | undefined,
): GlobMatcher {
  if (!patterns || patterns.length === 0) return () => true;
  const compiled = patterns.map(compileGlob);
  return (qualifiedName) => compiled.some((re) => re.test(qualifiedName));
}
