/**
 * Minimal glob matcher for `IntrospectionFilters.tables`. Matches against
 * `"<schema>.<name>"` strings; supports `*` (any run) and `?` (single char).
 * Identical to the postgres connector's matcher.
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

export function compileTableFilters(
  patterns: ReadonlyArray<string> | undefined,
): GlobMatcher {
  if (!patterns || patterns.length === 0) return () => true;
  const compiled = patterns.map(compileGlob);
  return (qualifiedName) => compiled.some((re) => re.test(qualifiedName));
}
