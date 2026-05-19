import type {
  NormalizedTenantPolicy,
  TenantScope,
  TenantAccess,
} from "../schema/v2/tenant-policy.js";

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
      params: unknown[];
      bindings: TenantBinding[];
      paramStartIndex: number;
    };

// ---------------------------------------------------------------------------
// Placeholder naming convention (matches tenant-prompt.ts)
// ---------------------------------------------------------------------------

const PLACEHOLDER_RE = /:tenant_([a-z0-9_]+)_ids/g;

export function placeholderForRoot(label: string): string {
  return `:tenant_${label.toLowerCase().replace(/[^a-z0-9]+/g, "_")}_ids`;
}

// ---------------------------------------------------------------------------
// Extract placeholders found in SQL
// ---------------------------------------------------------------------------

export function extractTenantPlaceholders(sql: string): string[] {
  const matches = new Set<string>();
  for (const m of sql.matchAll(PLACEHOLDER_RE)) {
    matches.add(m[0]);
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
      m.set(access.tenantRoot, access.rootIds);
      break;
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

// ---------------------------------------------------------------------------
// Replace placeholders — SQL-only mode (inline literals)
// ---------------------------------------------------------------------------

function escapeSqlLiteral(value: string): string {
  return "'" + value.replace(/'/g, "''") + "'";
}

export function replacePlaceholdersWithLiterals(
  sql: string,
  resolved: ResolvedPlaceholder[],
): string {
  let result = sql;
  for (const r of resolved) {
    if (r.ids.length === 0) continue;
    const literal =
      r.ids.length === 1
        ? escapeSqlLiteral(r.ids[0]!)
        : `(${r.ids.map(escapeSqlLiteral).join(", ")})`;

    result = replaceOperatorAware(result, r.placeholder, literal, r.ids.length > 1);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Replace placeholders — SQL+params mode (positional $N)
// ---------------------------------------------------------------------------

export function replacePlaceholdersWithParams(
  sql: string,
  resolved: ResolvedPlaceholder[],
  startIndex: number = 1,
): { sql: string; params: unknown[]; nextIndex: number } {
  let result = sql;
  const params: unknown[] = [];
  let idx = startIndex;

  for (const r of resolved) {
    if (r.ids.length === 0) continue;

    if (r.ids.length === 1) {
      const paramRef = `$${idx}`;
      result = replaceOperatorAware(result, r.placeholder, paramRef, false);
      params.push(r.ids[0]!);
      idx++;
    } else {
      const paramRefs = r.ids.map(() => `$${idx++}`);
      const paramList = `(${paramRefs.join(", ")})`;
      result = replaceOperatorAware(result, r.placeholder, paramList, true);
      params.push(...r.ids);
    }
  }
  return { sql: result, params, nextIndex: idx };
}

// ---------------------------------------------------------------------------
// Operator-aware replacement: = → IN when multiple values
// ---------------------------------------------------------------------------

function replaceOperatorAware(
  sql: string,
  placeholder: string,
  replacement: string,
  isMultiple: boolean,
): string {
  if (isMultiple) {
    const eqPattern = new RegExp(
      `=\\s*${escapeRegex(placeholder)}`,
      "g",
    );
    sql = sql.replace(eqPattern, `IN ${replacement}`);

    const inPattern = new RegExp(
      `IN\\s*\\(\\s*${escapeRegex(placeholder)}\\s*\\)`,
      "gi",
    );
    sql = sql.replace(inPattern, `IN ${replacement}`);
  }

  sql = sql.replace(new RegExp(escapeRegex(placeholder), "g"), replacement);
  return sql;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------------------------------------------------------------------------
// High-level entry point
// ---------------------------------------------------------------------------

export function resolveTenantSql(
  sql: string,
  policy: NormalizedTenantPolicy,
  scope: TenantScope,
  mode: TenantSqlOutputMode = "sql-only",
  paramStartIndex: number = 1,
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
      sql: replacePlaceholdersWithLiterals(sql, resolved),
      bindings,
    };
  }

  const paramResult = replacePlaceholdersWithParams(sql, resolved, paramStartIndex);
  return {
    mode: "sql-params",
    sql: paramResult.sql,
    params: paramResult.params,
    bindings,
    paramStartIndex,
  };
}
