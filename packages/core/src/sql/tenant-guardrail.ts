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
import { placeholderForRoot } from "./tenant-placeholders.js";

export type TenantGuardrailResult = {
  passed: boolean;
  warnings: TenantGuardrailWarning[];
};

export type ValidateTenantGuardrailsOptions = {
  /**
   * The target engine, so string literals and comments are read the way it reads
   * them: on MySQL/MariaDB `"…"` is a string, `#` starts a comment, and (with
   * `backslashEscapes`) `\'` does not end a string; on Postgres/CockroachDB `\'`
   * does not end an `E'…'` escape string. `ask()` passes it whenever it
   * has a `DialectSpec`. Without it the statement must pass under every reading
   * (see {@link validateTenantGuardrails}).
   */
  dialect?: Pick<DialectSpec, "id" | "backslashEscapes">;
};

/**
 * Validate generated SQL against the tenant policy and runtime scope.
 *
 * Pass the SQL **before** tenant substitution: the model's statement, with the
 * `:tenant_<root>_ids` placeholders still in place. That is the untrusted input;
 * `resolveTenantSql()` then only swaps each placeholder for literals or driver
 * markers. `ask()` and `generateSelectSql()` check that form.
 *
 * This is a heuristic, not a SQL parser. For each tenant-scoped table the query
 * mentions, it looks for a tenant predicate: the table's tenant column compared
 * with its root's placeholder (`col = :tenant_agency_ids`, `col IN
 * (:tenant_agency_ids)`, `col = ANY(:tenant_agency_ids)`, either side), ANDed into
 * a `WHERE`, `ON` or `HAVING` clause. A predicate beside an `OR` or `XOR` at any
 * enclosing level, under `NOT`, or anywhere but a filter clause (the select list,
 * a `CASE`) doesn't count, and neither does a literal ID or a bare mention of the
 * column. A root table the scope covers (`org.agency` under an `agency` scope)
 * needs the same predicate on its tenant ID column. It does not tie a predicate
 * to one table reference, so an unfiltered reference beside a filtered one can
 * still pass; database-side row-level security is the sound boundary.
 *
 * Identifiers are matched only in code regions: text inside string literals and
 * comments never counts as a table reference or a tenant predicate. Regions are
 * read the way `options.dialect` reads them. Without a dialect (a custom
 * `AskDialect`, or a direct call without `options.dialect`) the statement is read
 * the standard-SQL way, the Postgres way (`E'…'` escape strings), and the MySQL
 * way: a table counts as referenced if any reading sees it, and a tenant
 * predicate counts only if every reading does. So SQL whose scoping depends on
 * the dialect (`"agency_id"`, `'it\'s …'`, `E'it\'s …'`) is flagged, never
 * passed. A tenant placeholder counts only in its exact lowercase form, the only
 * form `resolveTenantSql()` substitutes.
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

  // Check the roots this scope covers: a query on the root table itself is scoped by its tenant ID column.
  for (const rootId of scopeRootIds(scope)) {
    const root = policy.roots.find((r) => r.id === rootId);
    if (!root || !mentionsTable(views, extractTableName(root.id))) continue;
    const column = extractColumnName(root.tenantIdColumn);
    if (!hasTenantPredicate(views, extractTableName(root.id), [column], [placeholderForRoot(root.label)])) {
      warnings.push(
        warn("MISSING_TENANT_PREDICATE", root.id,
          `Tenant root table '${extractTableName(root.id)}' is missing required tenant predicate. ` +
          `Expected: ${column} = ${placeholderForRoot(root.label)}`),
      );
    }
  }

  // Check scoped tables
  for (const st of policy.scopedTables) {
    const tableName = extractTableName(st.id);
    if (!mentionsTable(views, tableName)) continue;
    checkScopedTable(views, st, policy, scope, warnings);
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
  scope: TenantScope,
  warnings: TenantGuardrailWarning[],
): void {
  const table = extractTableName(st.id);
  for (const path of st.scopeThrough) {
    const root = policy.roots.find((r) => r.id === path.root);
    const placeholder = placeholderFor(policy, path.root);
    if ("column" in path) {
      // The table's tenant column compared with its root's placeholder.
      if (hasTenantPredicate(sql, table, [extractColumnName(path.column)], [placeholder])) return;
    } else {
      // Inherited via JOINs: every join column appears, and a tenant predicate
      // filters the root (on its tenant ID column, or, down a hierarchy, on any
      // placeholder this scope binds).
      const allStepsPresent = path.join.every(
        (step) => mentionsIdentifier(sql, extractColumnName(step.from)) && mentionsIdentifier(sql, extractColumnName(step.to)),
      );
      if (!allStepsPresent) continue;
      const scopePlaceholders = scopeRootIds(scope).map((id) => placeholderFor(policy, id));
      if (root && hasTenantPredicate(sql, table, [extractColumnName(root.tenantIdColumn)], [placeholder])) return;
      if (hasTenantPredicate(sql, table, undefined, [placeholder, ...scopePlaceholders])) return;
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
      `Expected one of: ${pathDescriptions.join(" OR ")}, compared with its tenant placeholder in a WHERE/ON/HAVING clause, ANDed (not OR-ed) with the rest`),
  );
}

function checkPolymorphicTable(
  sql: CodeViews,
  pt: PolymorphicTable,
  policy: NormalizedTenantPolicy,
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

  const placeholders = Object.values(pt.mapping).map((rootId) => placeholderFor(policy, rootId));
  if (!hasTenantPredicate(sql, extractTableName(pt.id), [idColName], placeholders)) {
    warnings.push(
      warn("MISSING_TENANT_PREDICATE", pt.id,
        `Polymorphic table '${extractTableName(pt.id)}' is missing a tenant predicate on '${idColName}' (compared with a tenant placeholder in a WHERE/ON/HAVING clause).`),
    );
  }
}

/** The placeholder `resolveTenantSql()` substitutes for a root (by its label). */
function placeholderFor(policy: NormalizedTenantPolicy, rootId: string): string {
  return placeholderForRoot(policy.roots.find((r) => r.id === rootId)?.label ?? rootId);
}

/** The tenant roots a scope binds IDs for (`global` binds none). */
function scopeRootIds(scope: TenantScope): string[] {
  const access = scope.access;
  switch (access.kind) {
    case "ids":
    case "subtree":
      return [access.tenantRoot];
    case "multi_root":
      return access.scopes.map((s) => s.tenantRoot);
    default:
      return [];
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
  /**
   * `E'…'` is a Postgres escape string: backslash escapes the next character
   * inside it even when `backslashEscapes` is off.
   */
  eStrings: boolean;
  /** `||` is logical OR (MySQL/MariaDB without `PIPES_AS_CONCAT`), not string concatenation. */
  pipesAreOr: boolean;
};

const STANDARD_READING: CodeReading = {
  doubleQuoted: "identifier",
  backslashEscapes: false,
  hashComments: false,
  eStrings: false,
  pipesAreOr: false,
};
const POSTGRES_READING: CodeReading = { ...STANDARD_READING, eStrings: true };
const MYSQL_READING: CodeReading = {
  doubleQuoted: "string",
  backslashEscapes: true,
  hashComments: true,
  eStrings: false,
  pipesAreOr: true,
};

/** One same-length view of the statement per reading; see {@link codeView}. */
type CodeViews = ReadonlyArray<{ readonly text: string; readonly reading: CodeReading }>;

/**
 * A known dialect gets its own single reading. An unknown one gets every reading
 * (standard SQL, Postgres with `E'…'` escape strings, MySQL): the statement is
 * ambiguous exactly where they differ, and the matchers below resolve that
 * ambiguity toward a warning (tables: any view; predicates: every view). A MySQL
 * server running with `ANSI_QUOTES` reads `"…"` as an identifier; the MySQL
 * reading still treats it as a string, so a predicate written only as
 * `"agency_id"` is flagged there, never passed.
 */
function codeViews(
  sql: string,
  dialect: ValidateTenantGuardrailsOptions["dialect"] | undefined,
): CodeViews {
  if (dialect === undefined || !isBuiltInDialectId(dialect.id)) {
    return [STANDARD_READING, POSTGRES_READING, MYSQL_READING].map((r) => ({ text: codeView(sql, r), reading: r }));
  }
  const backslashEscapes = dialect.backslashEscapes === true;
  const base =
    dialect.id === "mysql" || dialect.id === "mariadb"
      ? MYSQL_READING
      : dialect.id === "postgres" || dialect.id === "cockroachdb"
        ? POSTGRES_READING
        : STANDARD_READING;
  const reading = { ...base, backslashEscapes };
  return [{ text: codeView(sql, reading), reading }];
}

/** A character that continues an identifier, so an `E` before it is not a string prefix. */
const IDENTIFIER_CONTINUE = /[A-Za-z0-9_$\u0080-\uffff]/;

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
  /**
   * End (exclusive) of the string literal opened by `quote` at `open`. `escapes`
   * says whether backslash escapes the next character inside it.
   */
  const stringEnd = (open: number, quote: string, escapes: boolean): number => {
    let j = open + 1;
    while (j < sql.length) {
      const c = sql[j];
      if (c === "\\" && escapes) {
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
      const escapes = reading.backslashEscapes || (ch === "'" && isEStringPrefix(out, i, reading));
      const end = stringEnd(i, ch, escapes);
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

/**
 * Whether the `'` at `quote` opens a Postgres `E'…'` escape string: the character
 * before it is `E`/`e` and that `E` starts a new token (it is not the tail of an
 * identifier such as `date'…'`). `out` is the view built so far, where blanked
 * strings, comments, and quoted-identifier delimiters are spaces.
 */
function isEStringPrefix(out: readonly string[], quote: number, reading: CodeReading): boolean {
  if (!reading.eStrings || quote === 0) return false;
  const prefix = out[quote - 1];
  if (prefix !== "E" && prefix !== "e") return false;
  return quote < 2 || !IDENTIFIER_CONTINUE.test(out[quote - 2]!);
}

/** A table counts as referenced when any reading sees it. */
function mentionsTable(views: CodeViews, tableName: string): boolean {
  const pattern = new RegExp(`\\b${escapeRegex(tableName)}\\b`, "i");
  return views.some((view) => pattern.test(view.text));
}

/** A tenant column counts only when every reading sees it in code. */
function mentionsIdentifier(views: CodeViews, identifier: string): boolean {
  const pattern = new RegExp(`\\b${escapeRegex(identifier)}\\b`, "i");
  return views.every((view) => pattern.test(view.text));
}

// ---------------------------------------------------------------------------
// Tenant predicates
// ---------------------------------------------------------------------------

/** One token of a code view: a word, a tenant-style placeholder, or one punctuation or operator mark. */
type Token = {
  /** The token as written (placeholders are case-sensitive). */
  readonly text: string;
  /** Lower-cased, for keyword and identifier comparison. */
  readonly lower: string;
  /** Parenthesis nesting of the token; a `(` or `)` has the depth outside it. */
  readonly depth: number;
};

const TOKEN = /:[A-Za-z0-9_]+|::|\|\||<>|!=|<=|>=|[A-Za-z_\u0080-\uffff][\w$\u0080-\uffff]*|\d[\w.]*|\S/g;

/** Split a code view into tokens with their nesting depth. Strings and comments are already blanked. */
function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let depth = 0;
  for (const m of text.matchAll(TOKEN)) {
    const t = m[0];
    if (t === ")") depth = Math.max(0, depth - 1);
    tokens.push({ text: t, lower: t.toLowerCase(), depth });
    if (t === "(") depth++;
  }
  return tokens;
}

/** Keywords that open a clause whose conjuncts filter rows. */
const FILTER_CLAUSE = new Set(["where", "on", "having"]);
/** Keywords that end a filter clause at its own nesting level. */
const CLAUSE_END = new Set([
  "group", "order", "limit", "offset", "fetch", "union", "intersect", "except", "minus", "window",
  "qualify", "returning", "for", "lock", "into", "having", "where", "join", "inner", "left", "right",
  "full", "cross", "outer", "natural", "straight_join", "apply", "using",
]);
/** Words that put a predicate somewhere other than a filter conjunct (select list, `CASE`, assignment, …). */
const NOT_A_FILTER = new Set(["select", "from", "by", "when", "then", "else", "case", "end", "as", "set", "values", "distinct", "is"]);

/** Keywords that combine query blocks; each block is checked on its own. */
const SET_OPERATORS = new Set(["union", "intersect", "except", "minus"]);
/** Words other than identifiers that the predicate forms use. */
const PREDICATE_WORDS = new Set(["in", "any", "and", "or", "not", "xor"]);

/**
 * Whether the statement has a tenant predicate for `table` on every reading: a column
 * in `columns` (any column when undefined) compared with one of `placeholders`, as a
 * conjunct of a filter clause. Each top-level query block (split at `UNION`,
 * `INTERSECT`, `EXCEPT`) that mentions the table needs its own. See
 * {@link validateTenantGuardrails} for the rule.
 */
function hasTenantPredicate(
  views: CodeViews,
  table: string,
  columns: readonly string[] | undefined,
  placeholders: readonly string[],
): boolean {
  const wanted = columns?.map((c) => c.toLowerCase());
  const mentions = new RegExp(`\\b${escapeRegex(table)}\\b`, "i");
  return views.every((view) => {
    const tokens = tokenize(view.text);
    const blocks = queryBlocks(tokens);
    const scoped = blocks.filter(([from, to]) => tokens.slice(from, to).some((t) => mentions.test(t.text)));
    return (scoped.length > 0 ? scoped : blocks).every(([from, to]) =>
      tokens.slice(from, to).some((token, offset) => {
        const k = from + offset;
        if (!placeholders.includes(token.text)) return false;
        const span = predicateSpan(tokens, k, wanted);
        return span !== undefined && isFilterConjunct(tokens, span[0], span[1], view.reading);
      }),
    );
  });
}

/** Token ranges `[from, to)` of the statement's top-level query blocks. */
function queryBlocks(tokens: readonly Token[]): Array<[number, number]> {
  const blocks: Array<[number, number]> = [];
  let from = 0;
  tokens.forEach((t, i) => {
    if (t.depth === 0 && SET_OPERATORS.has(t.lower)) {
      blocks.push([from, i]);
      from = i + 1;
    }
  });
  blocks.push([from, tokens.length]);
  return blocks;
}

/** An identifier token: a word that isn't one of the predicate forms' keywords. */
function isIdentifier(token: Token): boolean {
  return /^[A-Za-z_\u0080-\uffff]/.test(token.text) && !PREDICATE_WORDS.has(token.lower);
}

/** A clause keyword used as a function name (`LEFT(status, 1)`, `RIGHT(…)`) is an identifier. */
function isFunctionCall(tokens: readonly Token[], i: number): boolean {
  return tokens[i + 1]?.text === "(" && isIdentifier(tokens[i]!);
}

/** Start index of a possibly qualified column (`o.agency_id`, `s.o.agency_id`) that ends at `end`. */
function qualifiedStart(tokens: readonly Token[], end: number): number {
  let start = end;
  while (tokens[start - 1]?.text === "." && tokens[start - 2] !== undefined && isIdentifier(tokens[start - 2]!)) start -= 2;
  return start;
}

/**
 * The token span `[start, end]` of a tenant predicate around the placeholder at `k`:
 * `col = P`, `P = col`, `col IN (P)` or `col = ANY (P)`, where `col` (the last part of a
 * possibly qualified name) is in `columns`, or anything when `columns` is undefined.
 */
function predicateSpan(tokens: readonly Token[], k: number, columns: readonly string[] | undefined): [number, number] | undefined {
  const at = (i: number) => tokens[i];
  const matches = (t: Token | undefined) => t !== undefined && isIdentifier(t) && (columns === undefined || columns.includes(t.lower));
  // col = P
  if (at(k - 1)?.text === "=" && matches(at(k - 2))) return [qualifiedStart(tokens, k - 2), k];
  const closed = at(k + 1)?.text === ")";
  // col IN ( P )
  if (closed && at(k - 1)?.text === "(" && at(k - 2)?.lower === "in" && matches(at(k - 3))) {
    return [qualifiedStart(tokens, k - 3), k + 1];
  }
  // col = ANY ( P )
  if (closed && at(k - 1)?.text === "(" && at(k - 2)?.lower === "any" && at(k - 3)?.text === "=" && matches(at(k - 4))) {
    return [qualifiedStart(tokens, k - 4), k + 1];
  }
  // P = col
  if (at(k + 1)?.text === "=") {
    let end = k + 2;
    while (at(end + 1)?.text === "." && at(end + 2) !== undefined && isIdentifier(at(end + 2)!)) end += 2;
    if (matches(at(end))) return [k, end];
  }
  return undefined;
}

/** How a parenthesized query block is used by the query around it. */
type SubqueryUse = "table" | "in" | "other";

/**
 * Whether the subquery opened by the `(` at `open` is a row source (a derived table in
 * `FROM`/`JOIN`, a CTE body after `AS`), the right side of `col IN (…)`, or anything else.
 * `EXISTS (…)` is "other": its filter limits the subquery's rows, not the outer query's.
 */
function subqueryUse(tokens: readonly Token[], open: number): SubqueryUse {
  const opener = tokens[open - 1];
  if (opener?.lower === "in") return tokens[open - 2] !== undefined && isIdentifier(tokens[open - 2]!) ? "in" : "other";
  if (opener?.lower === "as" || opener?.lower === "lateral") return "table";
  const depth = tokens[open]!.depth;
  for (let i = open - 1; i >= 0; i--) {
    const t = tokens[i]!;
    if (t.depth < depth) return "other";
    if (t.depth > depth) continue;
    if (t.lower === "from" || t.lower === "join" || t.lower === "apply") return "table";
    if (t.text !== "," && !(isIdentifier(t) && !CLAUSE_END.has(t.lower) && !NOT_A_FILTER.has(t.lower))) return "other";
  }
  return "other";
}

/** Whether the `ON` at `on` belongs to an outer join, whose `ON` doesn't filter the preserved side. */
function isOuterJoinOn(tokens: readonly Token[], on: number): boolean {
  const depth = tokens[on]!.depth;
  for (let i = on - 1; i >= 0; i--) {
    const t = tokens[i]!;
    if (t.depth < depth) return false;
    if (t.depth > depth || t.lower !== "join") continue;
    let kind = i - 1;
    if (tokens[kind]?.lower === "outer") kind--;
    return ["left", "right", "full"].includes(tokens[kind]?.lower ?? "");
  }
  return false;
}

/**
 * Whether the term `tokens[start..end]` is ANDed into a `WHERE`, `ON` (of an inner join)
 * or `HAVING` clause of the statement: at its own level and at every enclosing
 * parenthesized level up to that clause, it sits between `AND`s (or the clause's start
 * and end), with no `OR`, `XOR` (or MySQL's `||`) at that level and no `NOT` in front of
 * it. A clause inside a subquery counts only when the subquery is a row source (a
 * derived table or CTE), or when the whole `col IN (…)` around it is itself such a
 * conjunct; not inside `EXISTS (…)`, a scalar subquery, or a comparison. A level opened by a function call or a comparison doesn't count.
 */
function isFilterConjunct(tokens: readonly Token[], start: number, end: number, reading: CodeReading): boolean {
  const disjunction = (t: Token) => t.lower === "or" || t.lower === "xor" || (t.text === "||" && reading.pipesAreOr);
  const endsClause = (i: number) => CLAUSE_END.has(tokens[i]!.lower) && !isFunctionCall(tokens, i);
  let lo = start;
  let hi = end;
  let depth = tokens[start]!.depth;
  for (;;) {
    // What is directly around the term, at its level.
    const before = tokens[lo - 1];
    const after = tokens[hi + 1];
    const leftOk = before !== undefined && (before.lower === "and" || before.text === "(" || FILTER_CLAUSE.has(before.lower));
    const rightOk = after === undefined || after.lower === "and" || after.text === ")" || after.text === ";" || endsClause(hi + 1);
    if (!leftOk || !rightOk) return false;

    // Scan the rest of this level on both sides for a disjunction, a NOT, or the clause keyword.
    let clause = -1;
    let open = -1;
    for (let i = lo - 1; i >= 0; i--) {
      const t = tokens[i]!;
      if (t.depth < depth) {
        open = i; // the "(" opening this level
        break;
      }
      if (t.depth > depth) continue;
      if (disjunction(t) || t.lower === "not") return false;
      if (FILTER_CLAUSE.has(t.lower)) {
        clause = i;
        break;
      }
      if ((endsClause(i) || NOT_A_FILTER.has(t.lower)) && !isFunctionCall(tokens, i)) return false;
    }
    let close = tokens.length;
    for (let j = hi + 1; j < tokens.length; j++) {
      const t = tokens[j]!;
      if (t.depth < depth) {
        close = j; // the ")" closing this level
        break;
      }
      if (t.depth > depth) continue;
      if (t.text === ";" || endsClause(j)) break;
      if (disjunction(t)) return false;
    }

    if (clause >= 0) {
      if (tokens[clause]!.lower === "on" && isOuterJoinOn(tokens, clause)) return false;
      if (depth === 0) return true;
      // The clause is inside a subquery: how does the query around it use that subquery?
      const blockOpen = enclosing(tokens, clause, "(");
      const blockClose = enclosing(tokens, clause, ")");
      if (blockOpen < 0 || blockClose < 0) return false;
      const use = subqueryUse(tokens, blockOpen);
      if (use === "table") return true;
      if (use === "other") return false;
      lo = qualifiedStart(tokens, blockOpen - 2); // `col IN (…)`
      hi = blockClose;
      depth = tokens[blockOpen]!.depth;
      continue;
    }

    if (open < 0 || tokens[open]!.text !== "(" || close >= tokens.length || tokens[close]!.text !== ")") return false;
    // A parenthesized group counts only as a plain boolean conjunct: opened right after
    // WHERE/ON/HAVING, AND, or another "(". Anything else (`f(`, `IN (`, `EXISTS (`,
    // `NOT (`, `= (`) makes it something other than a filter conjunct.
    const opener = tokens[open - 1];
    if (opener === undefined || !(FILTER_CLAUSE.has(opener.lower) || opener.lower === "and" || opener.text === "(")) return false;
    lo = open;
    hi = close;
    depth = tokens[open]!.depth;
  }
}

/** Index of the `(` or `)` that encloses the token at `i`, or -1 at the top level. */
function enclosing(tokens: readonly Token[], i: number, paren: "(" | ")"): number {
  const depth = tokens[i]!.depth;
  const step = paren === "(" ? -1 : 1;
  for (let k = i + step; k >= 0 && k < tokens.length; k += step) {
    if (tokens[k]!.depth < depth) return tokens[k]!.text === paren ? k : -1;
  }
  return -1;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
