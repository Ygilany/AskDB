import { TenantScopeError } from "../errors.js";
import type {
  NormalizedTenantPolicy,
  TenantScope,
  TenantAccess,
} from "../schema/v2/tenant-policy.js";
import { isBuiltInDialectId, type DialectSpec } from "./dialect-spec.js";
import {
  escapeSqlLiteral,
  escapeSqlLiteralLegacy,
  formatMarker,
  markerStyleForDialect,
  scanTenantPlaceholders,
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
 * Omit it entirely for Postgres-style `$N` markers and quote-doubling only.
 */
export type TenantSqlDialect = Partial<Pick<DialectSpec, "id" | "backslashEscapes">>;

// ---------------------------------------------------------------------------
// Placeholder naming convention (matches tenant-prompt.ts)
// ---------------------------------------------------------------------------

export function placeholderForRoot(label: string): string {
  return `:tenant_${label.toLowerCase().replace(/[^a-z0-9]+/g, "_")}_ids`;
}

// ---------------------------------------------------------------------------
// Extract placeholders found in SQL (quote-aware via shared scanner)
// ---------------------------------------------------------------------------

export function extractTenantPlaceholders(sql: string): string[] {
  const matches = new Set<string>();
  for (const p of scanTenantPlaceholders(sql)) {
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
): ResolvedPlaceholder[] {
  const placeholders = extractTenantPlaceholders(sql);
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
      // Descendants are never expanded, so binding only `rootIds` would silently
      // under-return. validateTenantScope() already rejects this inside ask().
      throw subtreeUnsupportedError();
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

/** The error for `access.kind: "subtree"` — shared by scope validation and placeholder resolution. */
export function subtreeUnsupportedError(): TenantScopeError {
  return new TenantScopeError(
    'tenantScope.access.kind "subtree" is not supported yet: AskDB does not expand a root\'s ' +
      "descendants, so the query would silently cover only the listed rootIds. Resolve the " +
      'subtree in your application and pass the explicit IDs with { kind: "ids" } ' +
      '(or { kind: "multi_root" } across hierarchy levels).',
    "UNSUPPORTED_ACCESS_KIND",
  );
}

// ---------------------------------------------------------------------------
// Substitution — token-aware, one edit per code-region occurrence
// ---------------------------------------------------------------------------

function escapeTenantId(value: string, dialect?: Pick<DialectSpec, "backslashEscapes">): string {
  if (dialect === undefined) {
    return escapeSqlLiteralLegacy(value);
  }
  return escapeSqlLiteral(value, dialect);
}

type Edit = { start: number; end: number; text: string };

/**
 * Replace every tenant placeholder that sits in a code region of `sql`.
 * Placeholder text inside string literals or quoted identifiers is left alone
 * (the shared scanner never reports it), so a substituted value can never land
 * inside — or close — a surrounding literal.
 *
 * `render` runs once per occurrence, in source order, and returns one SQL
 * fragment (literal or driver marker) per tenant ID. Rendering in source order
 * is what keeps positional `?` markers aligned with their parameters.
 *
 * Fails closed: an occurrence whose placeholder has no IDs in scope, or matches
 * no tenant root, throws instead of shipping the raw `:tenant_*` text.
 */
function substituteTenantPlaceholders(
  sql: string,
  resolved: ResolvedPlaceholder[],
  render: (r: ResolvedPlaceholder) => string[],
): string {
  const byPlaceholder = new Map(resolved.map((r) => [r.placeholder, r]));
  const edits: Edit[] = [];
  for (const occ of scanTenantPlaceholders(sql)) {
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
  return substituteTenantPlaceholders(sql, resolved, (r) =>
    r.ids.map((id) => escapeTenantId(id, dialect)),
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
 * `nextIndex` is `startIndex + params.length`.
 */
export function replacePlaceholdersWithParams(
  sql: string,
  resolved: ResolvedPlaceholder[],
  startIndex: number = 1,
  dialect?: TenantSqlDialect,
): { sql: string; params: unknown[]; nextIndex: number } {
  const style = tenantMarkerStyle(dialect);
  const params: unknown[] = [];
  let idx = startIndex;
  const out = substituteTenantPlaceholders(sql, resolved, (r) =>
    r.ids.map((id) => {
      params.push(id);
      return tenantMarker(style, idx++);
    }),
  );
  return { sql: out, params, nextIndex: idx };
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
 * Throws `TenantScopeError` when a placeholder cannot be resolved
 * (`UNRESOLVED_TENANT_PLACEHOLDER`), when a multi-ID scope meets a predicate with
 * no list form (`UNSUPPORTED_TENANT_PREDICATE`), or for `subtree` access
 * (`UNSUPPORTED_ACCESS_KIND`). `global` scope returns `sql` unchanged.
 */
export function resolveTenantSql(
  sql: string,
  policy: NormalizedTenantPolicy,
  scope: TenantScope,
  mode: TenantSqlOutputMode = "sql-only",
  paramStartIndex: number = 1,
  dialect?: TenantSqlDialect,
): TenantPlaceholderResult {
  if (scope.access.kind === "global") {
    return mode === "sql-only"
      ? { mode: "sql-only", sql, bindings: [] }
      : { mode: "sql-params", sql, params: [], bindings: [], paramStartIndex };
  }

  const resolved = resolvePlaceholders(sql, policy, scope);
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
