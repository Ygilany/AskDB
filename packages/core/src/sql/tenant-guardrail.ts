import {
  TenantGuardrailError,
  type TenantGuardrailWarning,
  type TenantGuardrailRuleCode,
} from "../errors.js";
import type { AskDbLogger } from "../logging/askdb-logger.js";
import { AskDbLogEvent } from "../logging/log-events.js";
import type {
  NormalizedTenantPolicy,
  TenantScope,
  ScopedTable,
  PolymorphicTable,
} from "../schema/v2/tenant-policy.js";

export type TenantGuardrailResult = {
  passed: boolean;
  warnings: TenantGuardrailWarning[];
};

/**
 * Best-effort lint of generated SQL against the tenant policy and runtime scope.
 *
 * **This is not a security boundary.** It does not parse SQL. It lowercases the
 * statement and checks, with whole-word matching, that the identifiers a policy
 * expects (tenant column, join-path columns, or the `:tenant_*_ids` placeholder)
 * are *present* for each tenant-scoped table named in the SQL. It cannot tell a
 * `SELECT` list from a `WHERE` clause, and it cannot detect `OR`-widened,
 * negated, or subquery-scoped predicates: `SELECT tenant_id FROM t` and
 * `... WHERE tenant_id = :tenant_x_ids OR 1=1` both pass.
 *
 * Identifiers are matched only in code regions: text inside string literals and
 * comments never counts as a table reference or a tenant predicate.
 *
 * Its purpose is to catch obvious model mistakes (a forgotten tenant filter,
 * an unclassified table) early and cheaply. Real tenant isolation must come
 * from the database (for example row-level security) or from the host applying
 * the tenant predicate itself.
 *
 * `global` scope skips the check. In `strict` mode, throws `TenantGuardrailError`
 * when the check finds a problem. In `warn` mode, returns warnings without throwing.
 */
export function validateTenantGuardrails(
  sql: string,
  policy: NormalizedTenantPolicy,
  scope: TenantScope,
): TenantGuardrailResult {
  // Global scope bypasses tenant guardrails
  if (scope.access.kind === "global") {
    return { passed: true, warnings: [] };
  }

  const warnings: TenantGuardrailWarning[] = [];
  const normalizedSql = normalizeSql(sql);

  // Check scoped tables
  for (const st of policy.scopedTables) {
    const tableName = extractTableName(st.id);
    if (!mentionsTable(normalizedSql, tableName)) continue;
    checkScopedTable(normalizedSql, st, policy, warnings);
  }

  // Check polymorphic tables
  for (const pt of policy.polymorphicTables) {
    const tableName = extractTableName(pt.id);
    if (!mentionsTable(normalizedSql, tableName)) continue;
    checkPolymorphicTable(normalizedSql, pt, policy, warnings);
  }

  // Check unknown tables
  for (const entry of policy.coverage) {
    if (entry.classification !== "unknown") continue;
    const tableName = extractTableName(entry.tableId);
    if (mentionsTable(normalizedSql, tableName)) {
      warnings.push(
        warn("UNKNOWN_TABLE_REFERENCED", entry.tableId,
          `Query references unclassified table '${tableName}'. Classify it in tenant-policy.md.`),
      );
    }
  }

  const passed = warnings.length === 0;

  if (!passed && policy.enforcement === "strict") {
    throw new TenantGuardrailError(
      `Tenant guardrail validation failed (strict mode): ${warnings.map((w) => w.message).join("; ")}`,
      warnings,
    );
  }

  return { passed, warnings };
}

/**
 * Run {@link validateTenantGuardrails} over every SQL form the caller is about to
 * hand out (e.g. the bound `sql` and, when present, the `unboundSql`), merge the
 * findings into one result, and log a single pass/fail event.
 *
 * Every form is checked in `warn` mode first so the merged result lists all
 * findings; when the policy is `strict` and anything failed, a single
 * `TenantGuardrailError` is thrown afterwards. `extra` lets a caller fold in a
 * result reported by a custom generator so its findings are never dropped.
 *
 * Internal to `@askdb/core` — `ask()` and `generateSelectSql()` share it so the
 * check always runs on the SQL that is actually returned.
 */
export function enforceTenantGuardrails(
  sqls: ReadonlyArray<string | undefined>,
  policy: NormalizedTenantPolicy,
  scope: TenantScope,
  logger?: AskDbLogger,
  extra?: TenantGuardrailResult,
): TenantGuardrailResult {
  const collectPolicy: NormalizedTenantPolicy = { ...policy, enforcement: "warn" };
  const warnings: TenantGuardrailWarning[] = [];
  const seen = new Set<string>();
  const add = (w: TenantGuardrailWarning): void => {
    const key = `${w.rule}\u0000${w.tableId}\u0000${w.message}`;
    if (seen.has(key)) return;
    seen.add(key);
    warnings.push(w);
  };

  const checked = new Set<string>();
  for (const sql of sqls) {
    if (sql === undefined || checked.has(sql)) continue;
    checked.add(sql);
    for (const w of validateTenantGuardrails(sql, collectPolicy, scope).warnings) add(w);
  }
  for (const w of extra?.warnings ?? []) add(w);

  const passed = warnings.length === 0 && extra?.passed !== false;

  if (passed) {
    logger?.info({ event: AskDbLogEvent.TenantGuardrailPassed }, "tenant guardrail validation passed");
  } else {
    logger?.info(
      {
        event: AskDbLogEvent.TenantGuardrailFailed,
        warningCount: warnings.length,
        enforcement: policy.enforcement,
      },
      "tenant guardrail validation found issues",
    );
  }

  if (!passed && policy.enforcement === "strict") {
    const detail =
      warnings.length > 0
        ? warnings.map((w) => w.message).join("; ")
        : "the SQL generator reported a failed tenant guardrail";
    throw new TenantGuardrailError(
      `Tenant guardrail validation failed (strict mode): ${detail}`,
      warnings,
    );
  }

  return { passed, warnings };
}

// ---------------------------------------------------------------------------
// Per-table checks
// ---------------------------------------------------------------------------

function checkScopedTable(
  sql: string,
  st: ScopedTable,
  policy: NormalizedTenantPolicy,
  warnings: TenantGuardrailWarning[],
): void {
  for (const path of st.scopeThrough) {
    if ("column" in path) {
      const colName = extractColumnName(path.column);
      const rootLabel = policy.roots.find((r) => r.id === path.root)?.label ?? path.root;
      const placeholder = `:tenant_${rootLabel.toLowerCase().replace(/[^a-z0-9]+/g, "_")}_ids`;

      // Check if the tenant column or placeholder appears in the SQL
      if (mentionsIdentifier(sql, colName) || mentionsPlaceholder(sql, placeholder)) {
        return; // At least one scope path is satisfied
      }
    } else {
      // Inherited via JOINs — check if the join path columns appear
      const allStepsPresent = path.join.every((step) => {
        const fromCol = extractColumnName(step.from);
        const toCol = extractColumnName(step.to);
        return mentionsIdentifier(sql, fromCol) && mentionsIdentifier(sql, toCol);
      });
      if (allStepsPresent) {
        // Also verify the root table's tenant column appears somewhere
        const rootTenantCol = policy.roots.find((r) => r.id === path.root);
        if (rootTenantCol) {
          const rootColName = extractColumnName(rootTenantCol.tenantIdColumn);
          const rootLabel = rootTenantCol.label;
          const placeholder = `:tenant_${rootLabel.toLowerCase().replace(/[^a-z0-9]+/g, "_")}_ids`;
          if (mentionsIdentifier(sql, rootColName) || mentionsPlaceholder(sql, placeholder)) {
            return; // Join path + root filter present
          }
        }
      }
    }
  }

  // None of the scope paths were satisfied
  const pathDescriptions = st.scopeThrough.map((p) => {
    if ("column" in p) return extractColumnName(p.column);
    return p.join.map((j) => `${extractColumnName(j.from)}→${extractColumnName(j.to)}`).join(", ");
  });
  warnings.push(
    warn("MISSING_TENANT_PREDICATE", st.id,
      `Tenant-scoped table '${extractTableName(st.id)}' is missing required tenant predicate. ` +
      `Expected one of: ${pathDescriptions.join(" OR ")}`),
  );
}

function checkPolymorphicTable(
  sql: string,
  pt: PolymorphicTable,
  _policy: NormalizedTenantPolicy,
  warnings: TenantGuardrailWarning[],
): void {
  const typeColName = extractColumnName(pt.typeColumn);
  const idColName = extractColumnName(pt.idColumn);

  if (!mentionsIdentifier(sql, typeColName)) {
    warnings.push(
      warn("MISSING_TYPE_DISCRIMINATOR", pt.id,
        `Polymorphic table '${extractTableName(pt.id)}' is missing type discriminator column '${typeColName}' in WHERE clause.`),
    );
  }

  if (!mentionsIdentifier(sql, idColName)) {
    warnings.push(
      warn("MISSING_TENANT_PREDICATE", pt.id,
        `Polymorphic table '${extractTableName(pt.id)}' is missing id column '${idColName}' in WHERE/JOIN clause.`),
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function warn(
  rule: TenantGuardrailRuleCode,
  tableId: string,
  message: string,
): TenantGuardrailWarning {
  return { rule, tableId, message };
}

function extractTableName(tableId: string): string {
  // "table:public.orders" → "orders"
  const dot = tableId.lastIndexOf(".");
  return dot !== -1 ? tableId.slice(dot + 1) : tableId;
}

function extractColumnName(columnId: string): string {
  // "table:public.orders#agency_id" → "agency_id"
  const hash = columnId.lastIndexOf("#");
  return hash !== -1 ? columnId.slice(hash + 1) : columnId;
}

/**
 * Lowercase the statement and blank out everything that is not SQL code, so
 * identifier checks only see code regions. String literals (`'…'` with `''`
 * escapes, `$tag$…$tag$` bodies) and comments (`-- …`, `/* … *\/`) become spaces.
 * The output has the same length, so word boundaries at the seams are unchanged.
 *
 * Quoted identifiers (`"…"`, `` `…` ``, `[…]`) keep their contents and only lose
 * their delimiters: `"agency_id"` *is* the identifier `agency_id`, and blanking
 * it would hide `FROM "orders"` from the table check and skip that table.
 *
 * Known gaps (no dialect is threaded here): MySQL's default double-quoted
 * strings read as identifiers, and backslash escapes inside `'…'` are not
 * recognized.
 */
function normalizeSql(sql: string): string {
  const lower = sql.toLowerCase();
  const out = lower.split("");
  const blank = (from: number, to: number): void => {
    for (let k = from; k < to; k++) if (out[k] !== "\n") out[k] = " ";
  };
  const dollarTag = /\$(?:[a-z_][a-z0-9_]*)?\$/y;
  let i = 0;
  while (i < lower.length) {
    const ch = lower[i]!;
    const next = lower[i + 1];
    if (ch === "-" && next === "-") {
      const newline = lower.indexOf("\n", i);
      const end = newline === -1 ? lower.length : newline;
      blank(i, end);
      i = end;
      continue;
    }
    if (ch === "/" && next === "*") {
      const close = lower.indexOf("*/", i + 2);
      const end = close === -1 ? lower.length : close + 2;
      blank(i, end);
      i = end;
      continue;
    }
    if (ch === "'") {
      let j = i + 1;
      while (j < lower.length) {
        if (lower[j] === "'") {
          if (lower[j + 1] === "'") {
            j += 2;
            continue;
          }
          j++;
          break;
        }
        j++;
      }
      blank(i, j);
      i = j;
      continue;
    }
    if (ch === "$") {
      dollarTag.lastIndex = i;
      const tag = dollarTag.exec(lower);
      const close = tag ? lower.indexOf(tag[0], i + tag[0].length) : -1;
      if (tag && close !== -1) {
        const end = close + tag[0].length;
        blank(i, end);
        i = end;
        continue;
      }
      i++;
      continue;
    }
    if (ch === '"' || ch === "`" || ch === "[") {
      const close = lower.indexOf(ch === "[" ? "]" : ch, i + 1);
      out[i] = " ";
      if (close === -1) break;
      out[close] = " ";
      i = close + 1;
      continue;
    }
    i++;
  }
  return out.join("");
}

function mentionsTable(normalizedSql: string, tableName: string): boolean {
  const pattern = new RegExp(`\\b${escapeRegex(tableName.toLowerCase())}\\b`);
  return pattern.test(normalizedSql);
}

function mentionsIdentifier(normalizedSql: string, identifier: string): boolean {
  const pattern = new RegExp(`\\b${escapeRegex(identifier.toLowerCase())}\\b`);
  return pattern.test(normalizedSql);
}

/**
 * `\b` cannot anchor a token that starts with `:` (it needs a word character on
 * one side), so tenant placeholders get their own boundary check.
 */
function mentionsPlaceholder(normalizedSql: string, placeholder: string): boolean {
  const pattern = new RegExp(`(?<![\\w:])${escapeRegex(placeholder.toLowerCase())}(?!\\w)`);
  return pattern.test(normalizedSql);
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
