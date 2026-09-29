import { TenantScopeError } from "../errors.js";
import type {
  NormalizedTenantPolicy,
  TenantScope,
  TenantAccess,
} from "../schema/v2/tenant-policy.js";
import { getDialectSpec, isBuiltInDialectId, type DialectSpec } from "./dialect-spec.js";
import {
  escapeSqlLiteral,
  escapeSqlLiteralLegacy,
  formatMarker,
  markerStyleForDialect,
  scanTenantPlaceholders,
  tokenizeSqlSpans,
  type MarkerStyle,
  type PlaceholderOccurrence,
} from "./bind.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type TenantSqlOutputMode = "sql-only" | "sql-params";

export type TenantBinding = {
  placeholder: string;
  rootLabel: string;
  rootId: string;
  ids: string[];
};

export type TenantPlaceholderResult =
  | { mode: "sql-only"; sql: string; bindings: TenantBinding[] }
  | {
      mode: "sql-params";
      sql: string;
      /**
       * Tenant values in driver-marker order: `params[i]` fills the marker for
       * 1-based position `paramStartIndex + i` (`$N`, or `@p{N-1}` on SQL Server),
       * or the i-th tenant `?` in source order.
       */
      params: unknown[];
      bindings: TenantBinding[];
      paramStartIndex: number;
    };

/**
 * The parts of a dialect the tenant substituter reads: `id` picks the driver
 * marker style (`$N` / `?` / `@pN`); `backslashEscapes` drives literal escaping.
 * When `backslashEscapes` is unset, a built-in `id` supplies it (on for MySQL and
 * MariaDB); with an unknown `id`, a tenant ID containing a backslash throws
 * rather than guess. Omit the dialect entirely for Postgres-style `$N` markers
 * and quote-doubling only.
 */
export type TenantSqlDialect = Partial<Pick<DialectSpec, "id" | "backslashEscapes">>;

/** The lexer input for a {@link TenantSqlDialect}: only meaningful when an `id` is known. */
function lexerDialect(
  dialect: TenantSqlDialect | undefined,
): Pick<DialectSpec, "id" | "backslashEscapes"> | undefined {
  return dialect?.id === undefined
    ? undefined
    : { id: dialect.id, backslashEscapes: dialect.backslashEscapes };
}

// ---------------------------------------------------------------------------
// Placeholder naming convention (matches tenant-prompt.ts)
// ---------------------------------------------------------------------------

export function placeholderForRoot(label: string): string {
  return `:tenant_${label.toLowerCase().replace(/[^a-z0-9]+/g, "_")}_ids`;
}

// ---------------------------------------------------------------------------
// Extract placeholders found in SQL (quote-aware via shared scanner)
// ---------------------------------------------------------------------------

export function extractTenantPlaceholders(sql: string, dialect?: TenantSqlDialect): string[] {
  const matches = new Set<string>();
  for (const p of scanTenantPlaceholders(sql, lexerDialect(dialect))) {
    matches.add(p.placeholder);
  }
  return [...matches];
}

// ---------------------------------------------------------------------------
// Resolve placeholders to concrete ID values from the scope
// ---------------------------------------------------------------------------

type ResolvedPlaceholder = { placeholder: string; rootLabel: string; rootId: string; ids: string[] };

export function resolvePlaceholders(
  sql: string,
  policy: NormalizedTenantPolicy,
  scope: TenantScope,
  dialect?: TenantSqlDialect,
): ResolvedPlaceholder[] {
  const placeholders = extractTenantPlaceholders(sql, dialect);
  if (placeholders.length === 0) return [];

  const rootsByPlaceholder = new Map<string, { rootId: string; label: string }>();
  for (const root of policy.roots) {
    rootsByPlaceholder.set(placeholderForRoot(root.label), {
      rootId: root.id,
      label: root.label,
    });
  }

  const idsByRoot = buildIdsByRoot(scope.access);

  const resolved: ResolvedPlaceholder[] = [];
  for (const ph of placeholders) {
    const rootInfo = rootsByPlaceholder.get(ph);
    if (!rootInfo) continue;
    const ids = idsByRoot.get(rootInfo.rootId) ?? [];
    resolved.push({
      placeholder: ph,
      rootLabel: rootInfo.label,
      rootId: rootInfo.rootId,
      ids,
    });
  }
  return resolved;
}

function buildIdsByRoot(access: TenantAccess): Map<string, string[]> {
  const m = new Map<string, string[]>();
  switch (access.kind) {
    case "ids":
      m.set(access.tenantRoot, access.ids);
      break;
    case "subtree":
      // resolveTenantSql() rejects an unexpanded subtree before reaching here.
      throw unexpandedSubtreeError(access.tenantRoot, "resolveTenantSql()");
    case "multi_root":
      for (const s of access.scopes) {
        const existing = m.get(s.tenantRoot) ?? [];
        m.set(s.tenantRoot, [...existing, ...s.ids]);
      }
      break;
    case "global":
      break;
  }
  return m;
}

/**
 * The error for a `subtree` access that reached placeholder substitution or the
 * prompt builder unexpanded. Neither walks the hierarchy: binding only the seed
 * `rootIds` would silently drop every descendant, and a prompt naming only the
 * root's placeholder would invite the model to filter descendant roots through it.
 */
export function unexpandedSubtreeError(
  tenantRoot: string,
  caller: "resolveTenantSql()" | "buildTenantPromptBlock()",
): TenantScopeError {
  return new TenantScopeError(
    `tenantScope.access is an unexpanded 'subtree' of '${tenantRoot}'. ${caller} does not walk ` +
      "the hierarchy. Expand the subtree first: ask() does this when you pass " +
      "resolveTenantDescendants; a direct caller passes a 'multi_root' access with each tenant " +
      "root's IDs under that root (or an 'ids' access when the subtree is one root table).",
    "SUBTREE_NOT_RESOLVABLE",
  );
}

// ---------------------------------------------------------------------------
// Substitution — token-aware, one edit per code-region occurrence
// ---------------------------------------------------------------------------

function escapeTenantId(value: string, dialect?: TenantSqlDialect): string {
  if (dialect === undefined) {
    return escapeSqlLiteralLegacy(value);
  }
  let backslashEscapes = dialect.backslashEscapes;
  if (backslashEscapes === undefined && dialect.id !== undefined && isBuiltInDialectId(dialect.id)) {
    backslashEscapes = getDialectSpec(dialect.id).backslashEscapes;
  }
  if (backslashEscapes === undefined && value.includes("\\")) {
    // Doubling quotes alone leaves `\'` able to close the literal on an engine
    // that reads backslash escapes (MySQL's default), so don't guess.
    throw new TenantScopeError(
      `A tenant ID contains a backslash, and dialect '${dialect.id ?? "(no id)"}' does not say ` +
        "whether backslash escapes inside string literals. Set backslashEscapes on the dialect, " +
        "or use tenantSqlMode 'sql-params'.",
      "UNESCAPABLE_TENANT_ID",
    );
  }
  return escapeSqlLiteral(value, { backslashEscapes });
}

type Edit = { start: number; end: number; text: string };

/**
 * Replace every tenant placeholder that sits in a code region of `sql`.
 * Placeholder text inside string literals, quoted identifiers, or comments is
 * left alone (the shared lexer never reports it), so a substituted value can
 * never land inside — or close — a surrounding literal. With a dialect `id`,
 * those regions are lexed the way that engine reads them (e.g. MySQL backslash
 * escapes, where `'it\'s :tenant_x_ids'` is one string literal).
 *
 * `render` runs once per occurrence, in source order, and returns one SQL
 * fragment (literal or driver marker) per tenant ID. Rendering in source order
 * is what keeps positional `?` markers aligned with their parameters.
 *
 * Fails closed: an occurrence whose placeholder has no IDs in scope, or matches
 * no tenant root, throws instead of shipping the raw `:tenant_*` text. So does a
 * placeholder in any casing other than the exact lowercase form.
 */
function substituteTenantPlaceholders(
  sql: string,
  resolved: ResolvedPlaceholder[],
  render: (r: ResolvedPlaceholder) => string[],
  dialect?: TenantSqlDialect,
): string {
  rejectCaseVariantTenantPlaceholders(sql, dialect);
  const byPlaceholder = new Map(resolved.map((r) => [r.placeholder, r]));
  const edits: Edit[] = [];
  for (const occ of scanTenantPlaceholders(sql, lexerDialect(dialect))) {
    const r = byPlaceholder.get(occ.placeholder);
    if (!r || r.ids.length === 0) {
      throw new TenantScopeError(
        r
          ? `Generated SQL references ${occ.placeholder} but the current scope provides no IDs ` +
              `for tenant root '${r.rootId}'. Refusing to emit SQL with an unsubstituted tenant placeholder.`
          : `Generated SQL references ${occ.placeholder}, which matches no tenant root in the policy. ` +
              `Refusing to emit SQL with an unsubstituted tenant placeholder.`,
        "UNRESOLVED_TENANT_PLACEHOLDER",
      );
    }
    edits.push(planEdit(sql, occ, render(r)));
  }

  let out = sql;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
  }
  return out;
}

// `(?<!:)` so a `::type` cast is not read as a placeholder (matches the substituter's scanner).
const ANY_CASE_PLACEHOLDER_RE = /(?<!:):([a-z][a-z0-9_]*)/gi;

/**
 * Tenant placeholders are case-sensitive: the prompt names the exact lowercase
 * form, and the substituter (like `bindPreparedQuery()`) only recognizes that
 * form. Any other casing (`:TENANT_AGENCY_IDS`) would otherwise pass through
 * unsubstituted, so reject it rather than return SQL with a raw placeholder.
 * Scans the same code regions as the substituter.
 */
function rejectCaseVariantTenantPlaceholders(sql: string, dialect?: TenantSqlDialect): void {
  // Same code regions the substituter scans, so both agree on what is a placeholder.
  for (const span of tokenizeSqlSpans(sql, lexerDialect(dialect))) {
    if (span.kind !== "code") continue;
    for (const m of sql.slice(span.start, span.end).matchAll(ANY_CASE_PLACEHOLDER_RE)) {
      const name = m[1]!;
      const lower = name.toLowerCase();
      if (name === lower || !/^tenant_[a-z0-9_]+_ids$/.test(lower)) continue;
      throw new TenantScopeError(
        `Generated SQL references ${m[0]}, but tenant placeholders are case-sensitive and must be ` +
          `written :${lower}. Refusing to emit SQL with an unsubstituted tenant placeholder.`,
        "UNRESOLVED_TENANT_PLACEHOLDER",
      );
    }
  }
}

const IN_LIST_BEFORE = /\bIN\s*\(\s*$/i;
const CLOSE_PAREN_AFTER = /^\s*\)/;
const QUANTIFIED_BEFORE = /(?<![<>!=])(==|=|<>|!=)\s*(ANY|SOME|ALL)\s*\(\s*$/i;
const COMPARISON_BEFORE = /(?<![<>!=])(<>|!=|<=|>=|==|=|<|>)\s*$/;

/**
 * Decide how one occurrence is rewritten, from the operator in front of it.
 *
 * - Sole element of `IN (…)` / `NOT IN (…)`: the placeholder becomes the list.
 * - `= ANY(…)` / `= SOME(…)` → `IN (…)`; `<> ALL(…)` / `!= ALL(…)` → `NOT IN (…)`.
 * - `=` with several IDs → `IN (…)`; `!=` / `<>` with several IDs → `NOT IN (…)`.
 *   With one ID the operator is kept and only the placeholder is replaced.
 * - `<`, `>`, `<=`, `>=`, or any other position, with several IDs has no list
 *   meaning, so it throws rather than emit SQL that means something else.
 */
function planEdit(sql: string, occ: PlaceholderOccurrence, items: string[]): Edit {
  const before = sql.slice(0, occ.start);
  const after = sql.slice(occ.end);
  const list = items.join(", ");
  const close = CLOSE_PAREN_AFTER.exec(after);

  if (close && IN_LIST_BEFORE.test(before)) {
    return { start: occ.start, end: occ.end, text: list };
  }

  const quantified = close ? QUANTIFIED_BEFORE.exec(before) : null;
  if (quantified && close) {
    const op = quantified[1]!;
    const quantifier = quantified[2]!.toUpperCase();
    const positive = (op === "=" || op === "==") && quantifier !== "ALL";
    const negative = (op === "<>" || op === "!=") && quantifier === "ALL";
    if (!positive && !negative) {
      throw unsupportedPredicate(occ, `${op} ${quantifier}(…)`);
    }
    const start = occ.start - quantified[0]!.length;
    return {
      start,
      end: occ.end + close[0]!.length,
      text: spaced(sql, start, `${negative ? "NOT IN" : "IN"} (${list})`),
    };
  }

  if (items.length === 1) {
    return { start: occ.start, end: occ.end, text: items[0]! };
  }

  const comparison = COMPARISON_BEFORE.exec(before);
  if (comparison) {
    const op = comparison[1]!;
    const start = occ.start - comparison[0]!.length;
    if (op === "=" || op === "==") {
      return { start, end: occ.end, text: spaced(sql, start, `IN (${list})`) };
    }
    if (op === "!=" || op === "<>") {
      return { start, end: occ.end, text: spaced(sql, start, `NOT IN (${list})`) };
    }
    throw unsupportedPredicate(occ, op);
  }

  throw unsupportedPredicate(occ, undefined);
}

/** Prefix a space when the rewritten fragment would otherwise touch the preceding token. */
function spaced(sql: string, start: number, text: string): string {
  return start > 0 && !/\s/.test(sql[start - 1]!) ? ` ${text}` : text;
}

function unsupportedPredicate(occ: PlaceholderOccurrence, op: string | undefined): TenantScopeError {
  const where =
    op === undefined ? "outside a comparison or IN list" : `with operator '${op}'`;
  return new TenantScopeError(
    `Generated SQL uses ${occ.placeholder} ${where}, but the current scope has several tenant IDs ` +
      `and that predicate has no list form. Only =, !=, <>, IN (…), NOT IN (…), = ANY(…) and ` +
      `<> ALL(…) can bind multiple IDs. Refusing to emit SQL.`,
    "UNSUPPORTED_TENANT_PREDICATE",
  );
}

// ---------------------------------------------------------------------------
// Replace placeholders — SQL-only mode (inline literals)
// ---------------------------------------------------------------------------

export function replacePlaceholdersWithLiterals(
  sql: string,
  resolved: ResolvedPlaceholder[],
  dialect?: TenantSqlDialect,
): string {
  return substituteTenantPlaceholders(
    sql,
    resolved,
    (r) => r.ids.map((id) => escapeTenantId(id, dialect)),
    dialect,
  );
}

// ---------------------------------------------------------------------------
// Replace placeholders — SQL+params mode (dialect driver markers)
// ---------------------------------------------------------------------------

function tenantMarkerStyle(dialect: TenantSqlDialect | undefined): MarkerStyle {
  const id = dialect?.id;
  return id !== undefined && isBuiltInDialectId(id) ? markerStyleForDialect(id) : "dollar";
}

/**
 * Marker for the value at 1-based position `ordinal` of the params array the SQL
 * runs with. `$N` is 1-based and `@pN` 0-based (as in `bindPreparedQuery`);
 * `?` is positional by occurrence.
 */
function tenantMarker(style: MarkerStyle, ordinal: number): string {
  return style === "atp" ? formatMarker("atp", ordinal - 1) : formatMarker(style, ordinal);
}

/**
 * Replace tenant placeholders with dialect driver markers: `$N` for
 * Postgres/CockroachDB (and when no dialect id is given), `?` for
 * MySQL/MariaDB/SQLite, `@pN` for SQL Server. Each occurrence gets its own
 * markers, allocated in source order, and `params` lists the IDs in that same
 * order — so for `?` dialects `params` lines up with the markers left to right.
 *
 * `startIndex` is the 1-based position of the first tenant value in the params
 * array the SQL will run with (`1` when tenant values are the only params).
 */
export function replacePlaceholdersWithParams(
  sql: string,
  resolved: ResolvedPlaceholder[],
  startIndex: number = 1,
  dialect?: TenantSqlDialect,
): { sql: string; params: unknown[] } {
  const style = tenantMarkerStyle(dialect);
  const params: unknown[] = [];
  let idx = startIndex;
  const out = substituteTenantPlaceholders(
    sql,
    resolved,
    (r) =>
      r.ids.map((id) => {
        params.push(id);
        return tenantMarker(style, idx++);
      }),
    dialect,
  );
  return { sql: out, params };
}

// ---------------------------------------------------------------------------
// High-level entry point
// ---------------------------------------------------------------------------

/**
 * Substitute the `:tenant_<root>_ids` placeholders in `sql` with the IDs from
 * `scope` — as escaped literals (`"sql-only"`), or as dialect driver markers plus
 * a `params` array (`"sql-params"`). Only placeholders in code regions are
 * touched; text inside string literals and quoted identifiers is left as-is.
 *
 * A `subtree` access must already be expanded into per-root IDs (a `multi_root`
 * access, or `ids` when the subtree is one root table): `ask()` does this via its
 * `resolveTenantDescendants` option. This function does not walk the hierarchy, so
 * an unexpanded `subtree` throws (`SUBTREE_NOT_RESOLVABLE`) rather than bind the
 * seed IDs only.
 *
 * Also throws `TenantScopeError` when a placeholder cannot be resolved
 * (`UNRESOLVED_TENANT_PLACEHOLDER`) or when a multi-ID scope meets a predicate
 * with no list form (`UNSUPPORTED_TENANT_PREDICATE`), and in `sql-only` mode when
 * a tenant ID holds a backslash but the dialect's escaping is unknown
 * (`UNESCAPABLE_TENANT_ID`). `global` scope returns
 * `sql` unchanged.
 */
export function resolveTenantSql(
  sql: string,
  policy: NormalizedTenantPolicy,
  scope: TenantScope,
  mode: TenantSqlOutputMode = "sql-only",
  paramStartIndex: number = 1,
  dialect?: TenantSqlDialect,
): TenantPlaceholderResult {
  if (scope.access.kind === "subtree") {
    throw unexpandedSubtreeError(scope.access.tenantRoot, "resolveTenantSql()");
  }
  if (scope.access.kind === "global") {
    return mode === "sql-only"
      ? { mode: "sql-only", sql, bindings: [] }
      : { mode: "sql-params", sql, params: [], bindings: [], paramStartIndex };
  }

  const resolved = resolvePlaceholders(sql, policy, scope, dialect);
  const bindings: TenantBinding[] = resolved.map((r) => ({
    placeholder: r.placeholder,
    rootLabel: r.rootLabel,
    rootId: r.rootId,
    ids: r.ids,
  }));

  if (mode === "sql-only") {
    return {
      mode: "sql-only",
      sql: replacePlaceholdersWithLiterals(sql, resolved, dialect),
      bindings,
    };
  }

  const paramResult = replacePlaceholdersWithParams(sql, resolved, paramStartIndex, dialect);
  return {
    mode: "sql-params",
    sql: paramResult.sql,
    params: paramResult.params,
    bindings,
    paramStartIndex,
  };
}
