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
import { isBuiltInDialectId, type DialectSpec } from "./dialect-spec.js";

export type TenantGuardrailResult = {
  passed: boolean;
  warnings: TenantGuardrailWarning[];
};

export type ValidateTenantGuardrailsOptions = {
  /**
   * The target engine, so string literals and comments are read the way it reads
   * them: on MySQL/MariaDB `"…"` is a string, `#` starts a comment, and (with
   * `backslashEscapes`) `\'` does not end a string. `ask()` passes it whenever it
   * has a `DialectSpec`. Without it the statement must pass under every reading
   * (see {@link validateTenantGuardrails}).
   */
  dialect?: Pick<DialectSpec, "id" | "backslashEscapes">;
};

/**
 * Validate generated SQL against the tenant policy and runtime scope.
 *
 * Uses heuristic pattern matching to verify that tenant-scoped tables
 * have the required predicates. Falls back to conservative rejection
 * when the SQL cannot be proven safe.
 *
 * Identifiers are matched only in code regions: text inside string literals and
 * comments never counts as a table reference or a tenant predicate. Regions are
 * read the way `options.dialect` reads them. Without a dialect (a custom
 * `AskDialect`, or a direct call without `options.dialect`) the statement is read
 * both the standard-SQL way and the MySQL way: a table counts as referenced if
 * either reading sees it, and a tenant predicate counts only if both do. So SQL
 * whose scoping depends on the dialect (`"agency_id"`, `'it\'s …'`) is flagged,
 * never passed. A tenant placeholder counts only in its exact lowercase form,
 * the only form `resolveTenantSql()` substitutes.
 *
 * In `strict` mode, throws `TenantGuardrailError` on failure.
 * In `warn` mode, returns warnings without throwing.
 */
export function validateTenantGuardrails(
  sql: string,
  policy: NormalizedTenantPolicy,
  scope: TenantScope,
  options?: ValidateTenantGuardrailsOptions,
): TenantGuardrailResult {
  // Global scope bypasses tenant guardrails
  if (scope.access.kind === "global") {
    return { passed: true, warnings: [] };
  }

  const warnings: TenantGuardrailWarning[] = [];
  const views = codeViews(sql, options?.dialect);

  // Check scoped tables
  for (const st of policy.scopedTables) {
    const tableName = extractTableName(st.id);
    if (!mentionsTable(views, tableName)) continue;
    checkScopedTable(views, st, policy, warnings);
  }

  // Check polymorphic tables
  for (const pt of policy.polymorphicTables) {
    const tableName = extractTableName(pt.id);
    if (!mentionsTable(views, tableName)) continue;
    checkPolymorphicTable(views, pt, policy, warnings);
  }

  // Check unknown tables
  for (const entry of policy.coverage) {
    if (entry.classification !== "unknown") continue;
    const tableName = extractTableName(entry.tableId);
    if (mentionsTable(views, tableName)) {
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
 * `dialect` is the target engine, when known (undefined for a custom `AskDialect`).
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
  dialect?: ValidateTenantGuardrailsOptions["dialect"],
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
    for (const w of validateTenantGuardrails(sql, collectPolicy, scope, { dialect }).warnings) add(w);
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
  sql: CodeViews,
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
  sql: CodeViews,
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
 * How one engine separates code from strings and comments. `'…'` strings (with
 * `''` escapes), `--` and `/* *\/` comments, and `` `…` `` / `[…]` identifiers
 * are common to every reading.
 */
type CodeReading = {
  /** `"…"` is a quoted identifier (standard SQL) or a string literal (MySQL/MariaDB). */
  doubleQuoted: "identifier" | "string";
  /** Backslash escapes the next character inside string literals. */
  backslashEscapes: boolean;
  /** `#` starts a line comment (MySQL/MariaDB). */
  hashComments: boolean;
};

const STANDARD_READING: CodeReading = {
  doubleQuoted: "identifier",
  backslashEscapes: false,
  hashComments: false,
};
const MYSQL_READING: CodeReading = {
  doubleQuoted: "string",
  backslashEscapes: true,
  hashComments: true,
};

/** One same-length view of the statement per reading; see {@link codeView}. */
type CodeViews = readonly string[];

/**
 * A known dialect gets its own single reading. An unknown one gets both readings:
 * the statement is ambiguous exactly where they differ, and the matchers below
 * resolve that ambiguity toward a warning (tables: any view; predicates: every
 * view). A MySQL server running with `ANSI_QUOTES` reads `"…"` as an identifier;
 * the MySQL reading still treats it as a string, so a predicate written only as
 * `"agency_id"` is flagged there, never passed.
 */
function codeViews(
  sql: string,
  dialect: ValidateTenantGuardrailsOptions["dialect"] | undefined,
): CodeViews {
  if (dialect === undefined || !isBuiltInDialectId(dialect.id)) {
    return [codeView(sql, STANDARD_READING), codeView(sql, MYSQL_READING)];
  }
  const backslashEscapes = dialect.backslashEscapes === true;
  const base = dialect.id === "mysql" || dialect.id === "mariadb" ? MYSQL_READING : STANDARD_READING;
  return [codeView(sql, { ...base, backslashEscapes })];
}

/**
 * Blank out everything that is not SQL code, so identifier checks only see code
 * regions. String literals (`'…'`, `$tag$…$tag$` bodies, and `"…"` when the
 * reading says so) and comments become spaces. The output has the same length
 * and keeps the original case (placeholders are case-sensitive), so word
 * boundaries at the seams are unchanged.
 *
 * Quoted identifiers keep their contents and only lose their delimiters:
 * `"agency_id"` *is* the identifier `agency_id` on Postgres, and blanking it
 * would hide `FROM "orders"` from the table check and skip that table.
 */
function codeView(sql: string, reading: CodeReading): string {
  const out = sql.split("");
  const blank = (from: number, to: number): void => {
    for (let k = from; k < to; k++) if (out[k] !== "\n") out[k] = " ";
  };
  /** End (exclusive) of the string literal opened by `quote` at `open`. */
  const stringEnd = (open: number, quote: string): number => {
    let j = open + 1;
    while (j < sql.length) {
      const c = sql[j];
      if (c === "\\" && reading.backslashEscapes) {
        j += 2;
        continue;
      }
      if (c === quote) {
        if (sql[j + 1] === quote) {
          j += 2;
          continue;
        }
        return j + 1;
      }
      j++;
    }
    return sql.length;
  };
  const dollarTag = /\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/y;
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i]!;
    const next = sql[i + 1];
    if ((ch === "-" && next === "-") || (ch === "#" && reading.hashComments)) {
      const newline = sql.indexOf("\n", i);
      const end = newline === -1 ? sql.length : newline;
      blank(i, end);
      i = end;
      continue;
    }
    if (ch === "/" && next === "*") {
      const close = sql.indexOf("*/", i + 2);
      const end = close === -1 ? sql.length : close + 2;
      blank(i, end);
      i = end;
      continue;
    }
    if (ch === "'" || (ch === '"' && reading.doubleQuoted === "string")) {
      const end = stringEnd(i, ch);
      blank(i, end);
      i = end;
      continue;
    }
    if (ch === "$") {
      dollarTag.lastIndex = i;
      const tag = dollarTag.exec(sql);
      const close = tag ? sql.indexOf(tag[0], i + tag[0].length) : -1;
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
      const close = sql.indexOf(ch === "[" ? "]" : ch, i + 1);
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

/** A table counts as referenced when any reading sees it. */
function mentionsTable(views: CodeViews, tableName: string): boolean {
  const pattern = new RegExp(`\\b${escapeRegex(tableName)}\\b`, "i");
  return views.some((view) => pattern.test(view));
}

/** A tenant column counts only when every reading sees it in code. */
function mentionsIdentifier(views: CodeViews, identifier: string): boolean {
  const pattern = new RegExp(`\\b${escapeRegex(identifier)}\\b`, "i");
  return views.every((view) => pattern.test(view));
}

/**
 * `\b` cannot anchor a token that starts with `:` (it needs a word character on
 * one side), so tenant placeholders get their own boundary check. The match is
 * case-sensitive: `resolveTenantSql()` substitutes only the exact lowercase form
 * and rejects any other casing, so `:TENANT_AGENCY_IDS` is not a predicate.
 */
function mentionsPlaceholder(views: CodeViews, placeholder: string): boolean {
  const pattern = new RegExp(`(?<![\\w:])${escapeRegex(placeholder)}(?!\\w)`);
  return views.every((view) => pattern.test(view));
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
