import { type TenantGuardrailWarning, type TenantGuardrailRuleCode } from "../errors.js";
import {
  placeholderForTenantRoot,
  type NormalizedTenantPolicy,
  type TenantScope,
  type ScopedTable,
  type PolymorphicTable,
} from "../schema/v2/tenant-policy.js";
import { SQLSERVER_DIALECT, type DialectSpec } from "./dialect-spec.js";
import { decide, tenantFindings, throwIfDenied } from "./guardrail-decide.js";
import { findPostgresOnlyForms, type SqlToken } from "./lexer.js";
import { readSql, tenantCodeReadings, tenantStatementReadings, type CodeViewReading, type SqlRead } from "./readings.js";
import { EXPRESSION_KEYWORDS, EXPRESSION_PUNCTUATION } from "./tsql-batch.js";
import { denylistFor } from "./validate.js";

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
 * Best-effort lint of generated SQL against the tenant policy and runtime scope.
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
 * needs the same predicate on its tenant ID column, or a join on it to a read whose
 * column holding its IDs is filtered. Down a join path, each hop must be joined on the
 * columns the policy declares, up to a read filtered by the path's root or one of its
 * ancestors in the hierarchy; a join on other columns links nothing (#400). A
 * polymorphic table also needs `typeColumn = '<key>'` ANDed into
 * the same `SELECT`, with a `mapping` key of the root whose placeholder filters
 * its id column. Each read of a table needs its own predicate in its own `SELECT`
 * (#399): a CTE body, a derived table and a subquery are each their own, and a
 * qualified predicate counts only for the read its qualifier names. A read in a
 * derived table or CTE also counts as filtered when every reference to that source
 * is filtered on the column, which the source passes through unrenamed without
 * computing across its rows. A join it can't follow (through a derived table or CTE,
 * or across `SELECT`s) fails closed; database-side row-level security is the sound
 * boundary.
 *
 * **This is not a security boundary.** Its purpose is to catch model mistakes
 * (a forgotten or widened tenant filter, an unclassified table) early and
 * cheaply. Real tenant isolation must come from the database (for example
 * row-level security) or from the host applying the tenant predicate itself.
 *
 * Identifiers are matched only in code regions: text inside string literals and
 * comments never counts as a table reference or a tenant predicate. Regions are
 * read the way `options.dialect` reads them. Without a dialect (a custom
 * `AskDialect`, or a direct call without `options.dialect`) the statement is read
 * the standard-SQL way, the Postgres way (`E'…'` escape strings), and the MySQL
 * way (`--` starts a comment only before whitespace, and a `/*! … *\/` body is read
 * both as code and as a comment): a table counts as referenced if any reading sees it, and a tenant
 * predicate counts only if every reading does. So SQL whose scoping depends on
 * the dialect (`"agency_id"`, `'it\'s …'`, `E'it\'s …'`) is flagged, never
 * passed. A tenant placeholder counts only in its exact lowercase form, the only
 * form `resolveTenantSql()` substitutes.
 *
 * `global` scope skips the check. In `strict` mode, throws `TenantGuardrailError`
 * when the check finds a problem. In `warn` mode, returns warnings without throwing.
 */
export function validateTenantGuardrails(
  sql: string,
  policy: NormalizedTenantPolicy,
  scope: TenantScope,
  options?: ValidateTenantGuardrailsOptions,
): TenantGuardrailResult {
  const warnings = tenantRuleWarnings(sql, policy, scope, options?.dialect);
  // The rule plus a single-check decision, so the mode is read in one place.
  const modes = { tenant: policy.enforcement, sensitive: "off" } as const;
  throwIfDenied(decide(tenantFindings(warnings, "sql"), modes, "return"), modes, "return");
  return { passed: warnings.length === 0, warnings };
}

/**
 * The tenant rule alone: what {@link validateTenantGuardrails} finds in `sql`, with no
 * mode. Internal to `@askdb/core`; the guardrail checks and the validator share it.
 */
export function tenantRuleWarnings(
  sql: string,
  policy: NormalizedTenantPolicy,
  scope: TenantScope,
  dialect: ValidateTenantGuardrailsOptions["dialect"] | undefined,
): TenantGuardrailWarning[] {
  // Global scope bypasses tenant guardrails
  if (scope.access.kind === "global") return [];

  const warnings: TenantGuardrailWarning[] = [];
  const read = readSql(sql);

  // The per-table checks below read queries. A statement that isn't one (a `DO` block, `CALL`,
  // `EXPLAIN`, `SHOW`) can touch tables they never see, a `DO` body as a dollar-quoted string,
  // so it is refused here, under every dialect: read-only validation may be a custom
  // AskDialect's job (ADR 0010), tenant enforcement isn't (#698).
  const keyword = nonQueryKeyword(read, dialect);
  if (keyword !== undefined) {
    warnings.push(
      warn("NOT_SELECT_OR_WITH", "",
        `A statement starts with ${keyword}, not SELECT or WITH. The tenant check can only read a query's ` +
        "tenant predicates, so under a tenant policy it refuses any other statement."),
    );
  }

  // Nor can they see what a query reaches through a call that runs SQL or reads a table named
  // in a string they blank, runs SQL over another connection, or sets what row-level security
  // reads. The read-only check allows some of these as reads, and a custom AskDialect skips
  // it, so the tenant check refuses them under every dialect (#702). A listed name counts in any
  // code position, since an engine can reach a function without `(` right after its name.
  const name = uncheckableName(read, dialect);
  if (name !== undefined) {
    warnings.push(
      warn("UNCHECKABLE_FUNCTION", "",
        `The SQL names ${name}, a function that reads or scopes rows the tenant check can't see. Under a ` +
        "tenant policy, query the tables directly (pivot with CASE or FILTER, not crosstab), and don't " +
        "name a column, alias or parameter after one of these functions."),
    );
  }

  // When the SQL may be read as Postgres (a dialect on the Postgres lexer, one that is no built-in
  // engine, or none), refuse the forms only that reading can hold.
  const postgresOnly = findPostgresOnlyForms(sql, dialect);

  // The checks below match names as written. Postgres decodes a U&"…" name, so they can't tell
  // which table, column or function it is: refuse it rather than decode it (#704, #692).
  const escaped = postgresOnly.unicodeEscapedIdentifier;
  if (escaped !== undefined) {
    warnings.push(
      warn("UNICODE_ESCAPED_IDENTIFIER", "",
        `The SQL uses the Unicode-escaped name ${escaped}, which the tenant check can't read. ` +
        'Write the name in plain double quotes ("orders") or unquoted.'),
    );
  }

  // Past an E'…' string continued on a later line, Postgres and the checks below read different
  // strings, so a table or call could sit in what they take for a string: refuse it (#703).
  const continued = postgresOnly.escapeStringContinuation;
  if (continued) {
    warnings.push(
      warn("STRING_CONTINUATION", "",
        `The SQL continues the E'…' string at offset ${continued.start} on a later line, which Postgres reads with backslash ` +
        "escapes and the tenant check doesn't. Write one literal, or join the parts with ||."),
    );
  }

  // CockroachDB reads a b'…' byte string with backslash escapes, and the checks below don't, so
  // past one with a backslash or a continuation they read different strings: refuse it (#730).
  const bytes = postgresOnly.escapedByteString;
  if (bytes) {
    warnings.push(
      warn("ESCAPED_BYTE_STRING", "",
        `The SQL has a b'…' byte string at offset ${bytes.start} with a backslash or continued on a later line, which ` +
        "CockroachDB reads with backslash escapes and the tenant check doesn't. Write the bytes as a hex string cast to bytea ('\\x00'::bytea)."),
    );
  }

  const views = codeViews(read, dialect);

  // Check the roots this scope covers: a query on the root table itself is scoped by its tenant ID column.
  for (const rootId of scopeRootIds(scope)) {
    const root = policy.roots.find((r) => r.id === rootId);
    if (!root || !mentionsTable(views, extractTableName(root.id))) continue;
    const column = extractColumnName(root.tenantIdColumn);
    // Filtered on its own tenant ID column, or joined on it to a column that holds its IDs (a
    // query that joins the root for a label, filtered on the scoped table's tenant column; #400).
    const placeholder = placeholderForTenantRoot(root);
    const ownIdTarget = { placeholder, column, table: extractTableName(root.id) };
    if (!hasTenantPredicate(views, ownIdTarget.table, [ownIdTarget], { graph: policyGraph(policy), allowed: new Set([placeholder]) })) {
      warnings.push(
        warn("MISSING_TENANT_PREDICATE", root.id,
          `Tenant root table '${extractTableName(root.id)}' is missing required tenant predicate. ` +
          `Expected: ${column} = ${placeholderForTenantRoot(root)}`),
      );
    }
  }

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

  return warnings;
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
  const table = extractTableName(st.id);
  const graph = policyGraph(policy);
  for (const path of st.scopeThrough) {
    const placeholder = placeholderFor(policy, path.root);
    if ("column" in path) {
      // The table's tenant column compared with its root's placeholder, directly or through a join.
      const target = { placeholder, column: extractColumnName(path.column), table };
      if (hasTenantPredicate(sql, table, [target], { graph, allowed: new Set([placeholder]) })) return;
    } else {
      // Inherited via JOINs (#400): each hop joined on the columns the policy declares, to a read
      // filtered by the path's root or, up the hierarchy, one of its ancestors. A root outside that
      // chain filters nothing here, even one the scope binds.
      const allowed = new Set(selfAndAncestors(policy, path.root).map((rootId) => placeholderFor(policy, rootId)));
      if (hasTenantPredicate(sql, table, [], { graph, allowed })) return;
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
  const table = extractTableName(pt.id);
  const typeMentioned = mentionsIdentifier(sql, typeColName);

  if (!typeMentioned) {
    warnings.push(
      warn("MISSING_TYPE_DISCRIMINATOR", pt.id,
        `Polymorphic table '${table}' is missing type discriminator column '${typeColName}' in WHERE clause.`),
    );
  }

  const rootIds = [...new Set(Object.values(pt.mapping))];
  const targets = rootIds.map((rootId) => ({ placeholder: placeholderFor(policy, rootId), column: idColName, table }));
  if (!hasTenantPredicate(sql, table, targets)) {
    warnings.push(
      warn("MISSING_TENANT_PREDICATE", pt.id,
        `Polymorphic table '${table}' is missing a tenant predicate on '${idColName}' (compared with a tenant placeholder in a WHERE/ON/HAVING clause).`),
    );
    return;
  }

  // The id predicate filters by one root's IDs, so the discriminator must pick that root's
  // rows: `owner_type = 'agency' AND owner_id = :tenant_agency_ids`, ANDed in the same `SELECT`.
  const paired = rootIds.map((rootId, i) => ({
    ...targets[i]!,
    discriminator: {
      column: typeColName,
      values: Object.entries(pt.mapping).filter(([, r]) => r === rootId).map(([key]) => key),
    },
  }));
  if (typeMentioned && !hasTenantPredicate(sql, table, paired)) {
    const [key, rootId] = Object.entries(pt.mapping)[0] ?? ["<key>", ""];
    warnings.push(
      warn("MISSING_TYPE_DISCRIMINATOR", pt.id,
        `Polymorphic table '${table}' needs '${typeColName}' compared with the mapping key of the root whose placeholder filters '${idColName}', ` +
        `ANDed into the same clause (e.g. ${typeColName} = '${key}' AND ${idColName} = ${placeholderFor(policy, rootId)}).`),
    );
  }
}

/** The placeholder `resolveTenantSql()` substitutes for a root (by its label). */
function placeholderFor(policy: NormalizedTenantPolicy, rootId: string): string {
  return placeholderForTenantRoot(policy.roots.find((r) => r.id === rootId) ?? { id: rootId, label: rootId });
}

/**
 * The columns that hold a root's tenant IDs, each with its root's placeholder: the root's
 * own `tenantIdColumn`; the foreign key of each child root pointing at it (`hierarchy[]`,
 * `roots[].parent`), e.g. `sub_agencies.agency_id`; the tenant column of each table
 * scoped directly through it; and the last hop of each join path that reaches it (the
 * `from` column of a step whose `to` is the root's tenant ID column).
 */
function idCarriers(policy: NormalizedTenantPolicy, rootId: string): PredicateTarget[] {
  const root = policy.roots.find((r) => r.id === rootId);
  if (!root) return [];
  const placeholder = placeholderForTenantRoot(root);
  const carriers: PredicateTarget[] = [
    { placeholder, column: extractColumnName(root.tenantIdColumn), table: extractTableName(root.id) },
  ];
  for (const edge of policy.hierarchy) {
    if (edge.parent === rootId) carriers.push({ placeholder, column: extractColumnName(edge.foreignKey), table: extractTableName(edge.child) });
  }
  for (const child of policy.roots) {
    if (child.parent?.root === rootId) {
      carriers.push({ placeholder, column: extractColumnName(child.parent.foreignKey), table: extractTableName(child.id) });
    }
  }
  for (const st of policy.scopedTables) {
    for (const path of st.scopeThrough) {
      if (path.root !== rootId) continue;
      if ("column" in path) {
        carriers.push({ placeholder, column: extractColumnName(path.column), table: extractTableName(st.id) });
        continue;
      }
      for (const step of path.join) {
        if (step.to !== root.tenantIdColumn) continue;
        carriers.push({ placeholder, column: extractColumnName(step.from), table: tableOfColumn(step.from) });
      }
    }
  }
  return carriers;
}

/** `rootId` and every root above it in the policy's hierarchy (`hierarchy[]`, `roots[].parent`). */
function selfAndAncestors(policy: NormalizedTenantPolicy, rootId: string): string[] {
  const chain = [rootId];
  for (let i = 0; i < chain.length; i++) {
    const parents = [
      ...policy.hierarchy.filter((edge) => edge.child === chain[i]).map((edge) => edge.parent),
      policy.roots.find((r) => r.id === chain[i])?.parent?.root,
    ];
    for (const parent of parents) if (parent !== undefined && !chain.includes(parent)) chain.push(parent);
  }
  return chain;
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

/**
 * Words that start a T-SQL statement with no `;` before it (`SELECT 1 EXEC(...)` is two
 * statements): the words the read-only check denies on SQL Server, lowercase.
 */
const TSQL_STATEMENT_WORDS: ReadonlySet<string> = denylistFor(SQLSERVER_DIALECT);

/**
 * Whether a word after `prev` is inside an expression rather than at a statement start: after
 * `(`, a comma, an operator or `.`, or after a keyword an expression or a name follows (the
 * T-SQL boundary check's list, plus `AS` before an alias and `FOR` before `UPDATE` or `XML`).
 * Anything else, a value such as `NULL` included, may end a statement, so it fails closed.
 */
function continuesExpression(prev: SqlToken | undefined): boolean {
  if (!prev) return false;
  if (prev.kind === "punct") return prev.text !== ")" && EXPRESSION_PUNCTUATION.has(prev.text);
  return prev.kind === "word" && (EXPRESSION_KEYWORDS.has(prev.lower) || prev.lower === "as" || prev.lower === "for");
}

/**
 * The leading token of the first statement in `sql` that isn't a query, upper-cased (a
 * keyword, or the token's own text when it isn't a word), or undefined when every statement
 * starts with `SELECT` or `WITH`. A statement ends at each `;`, and under the SQL Server
 * reading also at a top-level word from {@link TSQL_STATEMENT_WORDS} that doesn't
 * {@link continuesExpression continue an expression}. Its first token is read
 * past comments and `(` with the shared lexer, under every reading from
 * `tenantStatementReadings`, so a statement any of them reads as a non-query counts.
 */
function nonQueryKeyword(read: SqlRead, dialect: ValidateTenantGuardrailsOptions["dialect"] | undefined): string | undefined {
  for (const profile of tenantStatementReadings(dialect)) {
    const tsql = profile.id === "sqlserver";
    let statementStart = true;
    let depth = 0;
    let prev: SqlToken | undefined;
    for (const token of read.tokens(profile)) {
      if (token.kind === "comment") continue;
      const before = prev;
      prev = token;
      if (token.kind === "punct" && token.text === ";") {
        statementStart = true;
        depth = 0;
        continue;
      }
      if (token.kind === "punct" && token.text === "(") {
        depth++;
        continue;
      }
      if (token.kind === "punct" && token.text === ")") depth = Math.max(0, depth - 1);
      if (statementStart) {
        statementStart = false;
        if (token.kind === "word" && (token.lower === "select" || token.lower === "with")) continue;
        return token.text.slice(0, 40).toUpperCase();
      }
      if (tsql && depth === 0 && token.kind === "word" && TSQL_STATEMENT_WORDS.has(token.lower) && !continuesExpression(before)) {
        return token.text.toUpperCase();
      }
    }
  }
  return undefined;
}

/**
 * Functions whose reads the tenant check can't see, lowercase (#702). A function belongs here when
 * it is built into Postgres or SQL Server, or comes from an extension that ships with Postgres
 * (`tablefunc`, `dblink`, `xml2`); any role can call it; and it runs a query passed as a string,
 * returns row data from a table, schema or database named in a string, runs SQL over another
 * connection, or sets a value row-level security may read. A function from any other extension
 * (pgRouting's `pgr_*`, SQLite's loadable `eval()`) or of the host's own isn't here and passes.
 * Fixed here, not taken from a `DialectSpec`, so a spec that overrides `blockedFunctions` can't
 * shrink it; and the read-only check allows the plain reads among them (`table_to_xml`, `crosstab`).
 */
const UNCHECKABLE_FUNCTIONS: ReadonlySet<string> = new Set([
  // Run a query passed as a string. `crosstab*` come from Postgres's `tablefunc` extension.
  "query_to_xml", "query_to_xmlschema", "query_to_xml_and_xmlschema", "cursor_to_xml", "ts_stat",
  "ts_rewrite", "crosstab", "crosstab2", "crosstab3", "crosstab4",
  // Return row data from a table, a schema or the database named in a string (`connectby` from
  // `tablefunc`, `dblink_build_sql_*` from `dblink`, `xpath_table` from `xml2`).
  "table_to_xml", "table_to_xml_and_xmlschema", "schema_to_xml", "schema_to_xml_and_xmlschema",
  "database_to_xml", "database_to_xml_and_xmlschema", "connectby",
  "dblink_build_sql_insert", "dblink_build_sql_update", "xpath_table",
  // Run SQL over another connection: Postgres's `dblink` extension, SQL Server's rowset functions.
  "dblink", "dblink_exec", "dblink_connect", "dblink_connect_u", "dblink_open", "dblink_send_query",
  "dblink_fetch", "dblink_get_result", "openquery", "openrowset", "opendatasource",
  // Set a value row-level security may read.
  "set_config",
]);

/**
 * The first name in `sql` from {@link UNCHECKABLE_FUNCTIONS}, lowercase, or undefined. A name counts
 * in any code position, in any case, bare, quoted or qualified, not only right before `(`: an
 * engine can reach a function in forms with no `(` after its name, so a column, an alias or a
 * placeholder named like a listed function counts too. Text in comments and single-quoted strings
 * doesn't. Read under every reading from `tenantStatementReadings`, so a name any of them sees counts.
 */
function uncheckableName(read: SqlRead, dialect: ValidateTenantGuardrailsOptions["dialect"] | undefined): string | undefined {
  for (const profile of tenantStatementReadings(dialect)) {
    for (const token of read.tokens(profile)) {
      const name = nameOf(token);
      if (name !== undefined && UNCHECKABLE_FUNCTIONS.has(name)) return name;
    }
  }
  return undefined;
}

/**
 * A token's name, lowercase, when it can name a function: a word, a quoted identifier, a `"…"`
 * string (which some servers read as a name), or a `:name` placeholder, which the shared lexer
 * reads as one token but Postgres reads as `:` and then a name.
 */
function nameOf(token: SqlToken): string | undefined {
  if (token.kind === "word" || token.kind === "quoted_identifier") return token.lower;
  if (token.kind === "string" && token.quote === '"') return token.text.slice(1, -1).toLowerCase();
  if (token.kind === "parameter" && token.text.startsWith(":") && !token.text.startsWith("::")) return token.lower.slice(1);
  return undefined;
}

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

function tableOfColumn(columnId: string): string {
  // "table:public.orders#agency_id" → "orders"
  const hash = columnId.lastIndexOf("#");
  return extractTableName(hash !== -1 ? columnId.slice(0, hash) : columnId);
}

function extractColumnName(columnId: string): string {
  // "table:public.orders#agency_id" → "agency_id"
  const hash = columnId.lastIndexOf("#");
  return hash !== -1 ? columnId.slice(hash + 1) : columnId;
}

/**
 * One same-length view of the statement per reading from `tenantCodeReadings` (see
 * {@link codeView}), with the statement itself (`source`), where string literals are still
 * readable at the same offsets, and the shared lexer's tokens under that reading.
 */
type CodeViews = ReadonlyArray<{
  readonly text: string;
  readonly source: string;
  readonly reading: CodeViewReading;
  readonly tokens: readonly SqlToken[];
}>;

/**
 * The statement's code views. A built-in engine gets its family's reading; any other id, or none,
 * gets every reading (standard SQL, Postgres with `E'…'` escape strings, MySQL): the statement is
 * ambiguous exactly where they differ, and the matchers below resolve that ambiguity toward a
 * warning (tables: any view; predicates: every view). A MySQL server running with `ANSI_QUOTES`
 * reads `"…"` as an identifier; the MySQL reading still treats it as a string, so a predicate
 * written only as `"agency_id"` is flagged there, never passed. A MySQL reading comes twice, with
 * the bodies of `/*! … *\/` executable comments read as code and as comments, since whether the
 * server runs one depends on its version.
 */
function codeViews(read: SqlRead, dialect: ValidateTenantGuardrailsOptions["dialect"] | undefined): CodeViews {
  return tenantCodeReadings(dialect).map((reading) => {
    const tokens = read.tokens(reading.profile);
    return { text: codeView(read.sql, tokens), source: read.sql, reading, tokens };
  });
}

/**
 * What a quoted identifier's delimiters become in a code view: not a word character, so
 * identifier matching still sees `"agency_id"` as `agency_id`, but the tokenizer can tell
 * a quoted `"where"` (an identifier) from the keyword `WHERE`.
 */
const QUOTE_MARK = "\u0001";

/**
 * `sql` with everything that is not code blanked, from the shared lexer's `tokens`, so identifier
 * checks only see code. Strings and comments become spaces (a newline stays); the body of an
 * executable comment the reading runs is code, since the lexer reads it as tokens. The output has
 * the same length and keeps the original case (placeholders are case-sensitive), so word
 * boundaries at the seams are unchanged.
 *
 * Quoted identifiers keep their contents, and each of their delimiters becomes
 * {@link QUOTE_MARK}, a doubled one inside them too: `"agency_id"` *is* the identifier
 * `agency_id` on Postgres, and blanking it would hide `FROM "orders"` from the table check.
 */
function codeView(sql: string, tokens: readonly SqlToken[]): string {
  const out = sql.split("");
  for (const token of tokens) {
    if (token.kind === "string" || token.kind === "comment") {
      // A string's prefix letter (`E'…'`, `N'…'`) stays code, as the check has always read it.
      const from = token.kind === "string" && /^[A-Za-z]/.test(token.text) ? token.start + 1 : token.start;
      for (let k = from; k < token.end; k++) if (out[k] !== "\n") out[k] = " ";
    } else if (token.kind === "quoted_identifier") {
      const close = token.quote === "[" ? "]" : token.quote;
      out[token.start] = QUOTE_MARK;
      for (let k = token.start + 1; k < token.end; k++) if (sql[k] === close) out[k] = QUOTE_MARK;
    }
  }
  return out.join("");
}

/**
 * A table counts as referenced when any reading sees its name in code, except as a word of
 * `ORDER BY` or `GROUP BY` (#828).
 */
function mentionsTable(views: CodeViews, tableName: string): boolean {
  const pattern = new RegExp(`\\b${escapeRegex(tableName)}\\b`, "gi");
  return views.some((view) =>
    [...view.text.matchAll(pattern)].some((m) => !inOrderOrGroupBy(view.text, m.index, m.index + m[0].length)),
  );
}

/**
 * Whether `text[start, end)` in a code view is a word of `ORDER BY` or `GROUP BY`. `ORDER` and
 * `GROUP` are reserved on every engine, so a table named after one is written quoted (`"order"`,
 * whose closing quote mark breaks the phrase) or qualified (`billing.order`, which Postgres takes
 * unquoted), and the `BY` after them is the keyword.
 */
function inOrderOrGroupBy(text: string, start: number, end: number): boolean {
  if (text[start - 1] === ".") return false;
  const word = text.slice(start, end).toLowerCase();
  if (word === "order" || word === "group") return /^\s+by(?![\w$\u0080-\uffff])/i.test(text.slice(end));
  return word === "by" && /(?:^|[^\w$\u0080-\uffff.\u0001])(?:order|group)\s+$/i.test(text.slice(0, start));
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
  /** Lower-cased, for matching a table's name. */
  readonly lower: string;
  /**
   * The name as the reading's engine compares an alias or a qualifier: a quoted name exactly, an
   * unquoted one with ASCII letters lower-cased under Postgres and SQLite, which fold it that way,
   * and exactly under MySQL and SQL Server, whose aliases can be case-sensitive.
   */
  readonly name: string;
  /** Lower-cased for keyword comparison; empty for a quoted identifier, which is never a keyword. */
  readonly kw: string;
  /** Parenthesis nesting of the token; a `(` or `)` has the depth outside it. */
  readonly depth: number;
  /** Offset of the token in the statement (a code view keeps the statement's offsets). */
  readonly offset: number;
};

const TOKEN = /:[A-Za-z0-9_]+|::|\|\||<>|!=|<=|>=|[A-Za-z_\u0080-\uffff][\w$\u0080-\uffff]*|\d[\w.]*|\S/g;
/** A {@link TOKEN} match that is a word or a number. */
const WORD_OR_NUMBER = /^[\w\u0080-\uffff]/;

/** Split a code view into tokens with their nesting depth. Strings and comments are already blanked. */
function tokenize(view: CodeViews[number]): Token[] {
  const tokens: Token[] = [];
  const split = view.reading.profile.tsqlLiterals ? lexerWordEnds(view) : undefined;
  const foldsCase = view.reading.profile.id === "postgres" || view.reading.profile.id === "generic";
  let depth = 0;
  let quoted = false;
  for (const m of view.text.matchAll(TOKEN)) {
    if (m[0] === QUOTE_MARK) {
      quoted = !quoted;
      continue;
    }
    for (const [t, offset] of split && WORD_OR_NUMBER.test(m[0]) ? split(m[0], m.index) : [[m[0], m.index] as const]) {
      if (t === ")") depth = Math.max(0, depth - 1);
      const lower = t.toLowerCase();
      const name = quoted || !foldsCase ? t : t.replace(/[A-Z]+/g, (s) => s.toLowerCase());
      tokens.push({ text: t, lower, name, kw: quoted ? "" : lower, depth, offset });
      if (t === "(") depth++;
    }
  }
  return tokens;
}

/**
 * Under a SQL Server reading, a word or number ends where the shared lexer ends it (#623): SQL
 * Server ends a number after `0x` or `1E` and a name at whitespace such as U+00A0, so in `1=0xOR 1=1`
 * or `1=1<U+00A0>OR 1=1` the `OR` is a keyword. Returns a function that cuts a word or number of the
 * view at each lexer token that starts inside it, dropping the characters the lexer reads as
 * whitespace. A quoted name is one lexer token, so it is never cut.
 */
function lexerWordEnds(view: CodeViews[number]): (text: string, offset: number) => Array<readonly [string, number]> {
  const owner = new Int32Array(view.text.length).fill(-1);
  view.tokens.forEach((token, index) => owner.fill(index, token.start, token.end));
  return (text, offset) => {
    const pieces: Array<readonly [string, number]> = [];
    let start = -1;
    const cut = (at: number) => {
      if (start >= 0) pieces.push([view.text.slice(start, at), start]);
      start = -1;
    };
    for (let k = offset; k < offset + text.length; k++) {
      if (owner[k] === -1 || (start >= 0 && owner[k] !== owner[start])) cut(k);
      if (owner[k] !== -1 && start < 0) start = k;
    }
    cut(offset + text.length);
    return pieces;
  };
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

/** Keywords that combine `SELECT`s; each branch is checked on its own. */
const SET_OPERATORS = new Set(["union", "intersect", "except", "minus"]);
/** Words other than identifiers that the predicate forms use. */
const PREDICATE_WORDS = new Set(["in", "any", "and", "or", "not", "xor"]);

/**
 * Whether the unquoted word at `i` is part of `ORDER BY` or `GROUP BY`. `ORDER` and `GROUP` are
 * reserved on every engine, so a table named after one is written quoted. Any other keyword may
 * name a table, unquoted, on some engine (`user` on MySQL, `lock` on Postgres), so its spelling
 * always counts as the table.
 */
function isOrderOrGroupBy(tokens: readonly Token[], i: number): boolean {
  const kw = tokens[i]!.kw;
  if (kw === "order" || kw === "group") return tokens[i + 1]?.kw === "by";
  return kw === "by" && (tokens[i - 1]?.kw === "order" || tokens[i - 1]?.kw === "group");
}

/**
 * What a tenant predicate compares: `column` (of `table`) with `placeholder`. With a
 * `discriminator`, the same `SELECT` must also AND in `discriminator.column = '<v>'`
 * for one of its `values` (a polymorphic table's type column and mapping keys).
 */
type PredicateTarget = {
  readonly placeholder: string;
  readonly column: string;
  readonly table: string;
  readonly discriminator?: { readonly column: string; readonly values: readonly string[] };
};

/**
 * The `SELECT`s of a code view (#399): the statement, every parenthesized query (a CTE body, a
 * derived table, a subquery) and each branch of a set operation in either. A tenant predicate
 * filters the reads of its own `SELECT`. Parentheses that open no query (a call, an `IN` list, a
 * boolean group, a parenthesized join) belong to the `SELECT` around them.
 */
type Scopes = {
  /** Each token's `SELECT`, as `"<open>:<branch>"`: `open` is the index of the `(` that opens its query, or -1. */
  readonly of: readonly string[];
  /** The `)` that closes each query's `(`. */
  readonly close: ReadonlyMap<number, number>;
  /** The queries (by their `(`, or -1 for the statement) with a set operator at their own level. */
  readonly branched: ReadonlySet<number>;
};

/** One code view, read for the tenant predicates: its tokens and `SELECT`s. */
type Analysis = {
  readonly view: CodeViews[number];
  readonly tokens: readonly Token[];
  readonly scopes: Scopes;
};

/** A read of a table: its token, its `SELECT`, and the names a qualifier may use for it. */
type Read = { readonly at: number; readonly scope: string; readonly names: ReadonlySet<string> };

/** Where a tenant predicate filters: a `SELECT`, and the qualifier that ties it to a read there. */
type Filter = {
  readonly scope: string;
  readonly qualifier: string | undefined;
  /** The `ON` the predicate sits in, when it sits in one. */
  readonly on?: number;
};

/** A tenant predicate for one target, and the `SELECT`s it filters. */
type Occurrence = { readonly target: PredicateTarget; readonly filters: readonly Filter[] };

/** Words that start a query right after its `(`. */
const QUERY_START = new Set(["select", "with", "values", "table"]);
/** Words that end a row source with no alias under every reading: no engine takes one as an alias. */
const ENDS_A_SOURCE = new Set([
  "where", "group", "order", "having", "union", "intersect", "except", "join", "inner", "left", "right", "cross", "outer", "on",
]);
/** The words of a join, which put a second source in a `FROM`. */
const JOIN_WORDS = new Set(["join", "inner", "left", "right", "full", "cross", "outer", "natural", "straight_join", "apply", "using"]);

const analyses = new WeakMap<CodeViews[number], Analysis>();

/** The view's tokens and `SELECT`s, read once per view. */
function analyze(view: CodeViews[number]): Analysis {
  let analysis = analyses.get(view);
  if (analysis === undefined) {
    const tokens = tokenize(view);
    analysis = { view, tokens, scopes: readScopes(tokens) };
    analyses.set(view, analysis);
  }
  return analysis;
}

/** Whether the `(` at `open` opens a query: `SELECT`, `WITH`, `VALUES` or `TABLE` right after it, past any further `(`. */
function opensQuery(tokens: readonly Token[], open: number): boolean {
  let j = open + 1;
  while (tokens[j]?.text === "(") j++;
  return QUERY_START.has(tokens[j]?.kw ?? "");
}

function readScopes(tokens: readonly Token[]): Scopes {
  const of: string[] = [];
  const close = new Map<number, number>();
  const branched = new Set<number>();
  const frames = [{ open: -1, branch: 0, depth: 0 }];
  tokens.forEach((t, i) => {
    let top = frames[frames.length - 1]!;
    if (t.text === ")" && top.open >= 0 && t.depth === tokens[top.open]!.depth) {
      close.set(top.open, i);
      frames.pop();
      top = frames[frames.length - 1]!;
    }
    of.push(scopeKey(top.open, top.branch));
    if (SET_OPERATORS.has(t.kw) && t.depth === top.depth) {
      top.branch++;
      branched.add(top.open);
    }
    if (t.text === "(" && opensQuery(tokens, i)) frames.push({ open: i, branch: 0, depth: t.depth + 1 });
  });
  return { of, close, branched };
}

/** A `SELECT`'s key: the `(` that opens its query (-1 for the statement) and its set-operation branch. */
function scopeKey(open: number, branch: number): string {
  return `${open}:${branch}`;
}

/** The `(` that opens a `SELECT`'s query, or -1 for the statement's (see {@link scopeKey}). */
function scopeOpen(scope: string): number {
  return Number.parseInt(scope, 10);
}

function isWord(token: Token | undefined): boolean {
  return token !== undefined && /^[A-Za-z_\u0080-￿]/.test(token.text);
}

/**
 * Whether the token at `k`, right after a row source, ends that source with no alias in `view`'s
 * reading: the end of the statement, `,`, `)`, `;`, a word in {@link ENDS_A_SOURCE}, a join word
 * the reading's engine reserves (`FULL` but on MySQL, `NATURAL` and `USING` but on SQL Server,
 * MySQL's `STRAIGHT_JOIN`), a SQL Server `WITH (` hint, or a MySQL `FORCE`/`USE`/`IGNORE INDEX`.
 * Any other word may be an alias on some engine (`force`, `lock`, `qualify` are on Postgres).
 */
function endsSource(a: Analysis, k: number): boolean {
  const t = a.tokens[k];
  if (t === undefined || t.text === "," || t.text === ")" || t.text === ";") return true;
  const engine = a.view.reading.profile.id;
  const next = a.tokens[k + 1];
  switch (t.kw) {
    case "full": return engine !== "mysql";
    case "natural": case "using": return engine !== "sqlserver";
    case "straight_join": return engine === "mysql";
    case "with": return next?.text === "(";
    case "force": case "use": case "ignore": return next?.kw === "index" || next?.kw === "key";
    default: return ENDS_A_SOURCE.has(t.kw);
  }
}

/** The token that names the row source ending at `i` (`orders o`, `orders AS o`, `) t`): its alias, if one may follow. */
function aliasAt(a: Analysis, i: number): number | undefined {
  if (a.tokens[i + 1]?.kw === "as") return isWord(a.tokens[i + 2]) ? i + 2 : undefined;
  return endsSource(a, i + 1) || !isWord(a.tokens[i + 1]) ? undefined : i + 1;
}

/**
 * The names the table reference at `i` goes by: its alias, or its own name when what follows ends
 * it with no alias. Anything else after it may be an alias the check doesn't recognise, so the
 * read gets no name and only an unqualified predicate filters it.
 */
function readNames(a: Analysis, i: number): Set<string> {
  const alias = aliasAt(a, i);
  if (alias !== undefined) return new Set([a.tokens[alias]!.name]);
  return endsSource(a, i + 1) ? new Set([a.tokens[i]!.name]) : new Set();
}

/** Whether the alias of the row source ending at `i` has a column list (`x t (a, b)`), which renames its output. */
function hasColumnList(a: Analysis, i: number): boolean {
  const alias = aliasAt(a, i);
  return alias !== undefined && a.tokens[alias + 1]?.text === "(";
}

/** Whether the `(` at `open` follows `AS` (or `AS [NOT] MATERIALIZED`), as a CTE body does. */
function opensAfterAs(tokens: readonly Token[], open: number): boolean {
  let k = open - 1;
  if (tokens[k]?.kw === "materialized") k -= tokens[k - 1]?.kw === "not" ? 2 : 1;
  return tokens[k]?.kw === "as";
}

/**
 * The CTE named before the `(` at `open` (`WITH x AS (`, `, x AS MATERIALIZED (`): its name and
 * token. Undefined when it isn't one, or when a column list (`x (a, b) AS (`) renames its output.
 */
function cteAt(tokens: readonly Token[], open: number): { readonly name: string; readonly at: number } | undefined {
  let k = open - 1;
  if (tokens[k]?.kw === "materialized") k -= tokens[k - 1]?.kw === "not" ? 2 : 1;
  if (tokens[k]?.kw !== "as" || !isWord(tokens[k - 1])) return undefined;
  const before = tokens[k - 2];
  if (!(before?.kw === "with" || before?.kw === "recursive" || before?.text === ",")) return undefined;
  return { name: tokens[k - 1]!.lower, at: k - 1 };
}

/**
 * The reads of `name`: every spelling of it, quoted or not, except a word of `ORDER BY` or
 * `GROUP BY` and a qualifier (`orders.id`), which refers to a read rather than being one. A read
 * goes by its names ({@link readNames}): an alias only, once it has one, since the table's name
 * then refers to another read, or to none.
 */
function readsOf(a: Analysis, name: string): Read[] {
  const reads: Read[] = [];
  a.tokens.forEach((t, i) => {
    if (t.lower !== name || isOrderOrGroupBy(a.tokens, i) || a.tokens[i + 1]?.text === ".") return;
    reads.push({ at: i, scope: a.scopes.of[i]!, names: readNames(a, i) });
  });
  return reads;
}

/** The qualifier of the column at `column` (`o` in `o.agency_id`), if any, as the reading compares names. */
function qualifierOf(tokens: readonly Token[], column: number): string | undefined {
  return tokens[column - 1]?.text === "." ? tokens[column - 2]?.name : undefined;
}

/** Every tenant predicate in the view for one of `targets`, with the `SELECT`s it filters. */
function occurrences(a: Analysis, targets: readonly PredicateTarget[]): Occurrence[] {
  const found: Occurrence[] = [];
  a.tokens.forEach((t, k) => {
    for (const target of targets) {
      if (t.text !== target.placeholder) continue;
      const predicate = predicateAt(a.tokens, k, target.column);
      if (!predicate) continue;
      const filters = filteredScopes(a, predicate.start, predicate.end, qualifierOf(a.tokens, predicate.column));
      if (filters.length > 0) found.push({ target, filters });
    }
  });
  return found;
}

/** What {@link inScope} proves a read against: the policy's graph, and the placeholders of the roots allowed. */
type JoinProof = { readonly graph: PolicyGraph; readonly allowed: ReadonlySet<string> };

/**
 * Whether every read of `table` is filtered, on every reading, by a predicate from `targets`
 * (#399): a column and placeholder compared as a conjunct of a filter clause in the read's own
 * `SELECT`, and tied to that read by its qualifier. Each branch of a `UNION` / `INTERSECT` /
 * `EXCEPT` is its own `SELECT`, and so is every CTE body, derived table and subquery. A read in a
 * derived table or CTE is also filtered from outside, when that source passes the column through
 * unrenamed and every reference to it is filtered on it. See {@link validateTenantGuardrails}.
 */
function hasTenantPredicate(views: CodeViews, table: string, targets: readonly PredicateTarget[], joinProof?: JoinProof): boolean {
  const name = table.toLowerCase();
  return views.every((view) => {
    const a = analyze(view);
    const reads = readsOf(a, name);
    if (reads.length === 0) return true;
    const found = occurrences(a, targets);
    return reads.every((read) =>
      readFiltered(a, found, targets, read, name) ||
      (joinProof !== undefined && inScope(proofFor(a, joinProof.graph), { ...read, table: name }, joinProof.allowed)));
  });
}

function readFiltered(a: Analysis, found: readonly Occurrence[], targets: readonly PredicateTarget[], read: Read, table: string): boolean {
  for (const o of found) {
    for (const f of o.filters) {
      if (f.scope !== read.scope || !filtersRead(f, o.target, read, table)) continue;
      if (o.target.discriminator && !hasDiscriminator(a, read, o.target)) continue;
      return true;
    }
  }
  return targets.some((target) => target.table.toLowerCase() === table && !target.discriminator && filteredFromOutside(a, found, read, target, 0));
}

/**
 * Whether a predicate on the read's own table that filters `read`'s `SELECT` through `filter`
 * filters `read` itself. Unqualified, it does: the read's table has the column, so the name
 * resolves to it or the SQL is ambiguous. Qualified, its qualifier must name that read
 * ({@link readNames}); a qualifier that names no read the check sees, such as a
 * table function's alias, counts for nothing. A predicate on another table's column counts only
 * through a join {@link inScope} can follow (#400).
 */
function filtersRead(filter: Filter, target: PredicateTarget, read: Read, table: string): boolean {
  if (target.table.toLowerCase() !== table) return false;
  return filter.qualifier === undefined || read.names.has(filter.qualifier);
}

/**
 * Whether `read`, inside a derived table or CTE, is filtered from outside on `target`'s column:
 * its `SELECT` is the source's whole body, the body passes the column through unrenamed, and
 * every reference to the source is filtered on that column in its own `SELECT`, directly or,
 * through a source around it, the same way. A set operation in the body, a column list on the
 * source, a recursive CTE or a CTE nothing reads fails closed.
 */
function filteredFromOutside(a: Analysis, found: readonly Occurrence[], read: Read, target: PredicateTarget, depth: number): boolean {
  // Each source's answer is worked out once per call: re-exploring it once per path is exponential
  // in a chain of sources that each read the one before several times.
  let memo = outsideMemo.get(found);
  if (memo === undefined) outsideMemo.set(found, (memo = new Map()));
  const key = `${read.scope}|${depth}|${[...read.names].join(" ")}|${target.table}|${target.column}|${target.placeholder}`;
  const known = memo.get(key);
  if (known !== undefined) return known;
  memo.set(key, false); // a cycle fails closed
  const open = scopeOpen(read.scope);
  let filtered = false;
  if (depth <= 8 && open >= 0 && !a.scopes.branched.has(open)) {
    const refs = sourceRefs(a, open);
    filtered = refs !== undefined && refs.length > 0 && passesThrough(a, open, read.names, target.column.toLowerCase()) &&
      refs.every((ref) =>
        found.some((o) =>
          o.target === target &&
          o.filters.some((f) => f.scope === ref.scope && (f.qualifier === undefined || ref.names.has(f.qualifier)))) ||
        filteredFromOutside(a, found, ref, target, depth + 1));
  }
  memo.set(key, filtered);
  return filtered;
}

const outsideMemo = new WeakMap<readonly Occurrence[], Map<string, boolean>>();
const sourceRefsMemo = new WeakMap<Analysis, Map<number, Read[] | undefined>>();

/**
 * The references to the row source whose query opens at `open`, or undefined when it isn't a source
 * this check follows: a column list on the source or on a reference to it renames its output.
 */
function sourceRefs(a: Analysis, open: number): Read[] | undefined {
  let memo = sourceRefsMemo.get(a);
  if (memo === undefined) sourceRefsMemo.set(a, (memo = new Map()));
  if (!memo.has(open)) memo.set(open, readSourceRefs(a, open));
  return memo.get(open);
}

function readSourceRefs(a: Analysis, open: number): Read[] | undefined {
  const { tokens, scopes } = a;
  const close = scopes.close.get(open);
  if (close === undefined || subqueryUse(tokens, open) !== "table") return undefined;
  if (opensAfterAs(tokens, open)) {
    const cte = cteAt(tokens, open);
    if (cte === undefined) return undefined; // a column list renames the output, or it's no CTE this check reads
    const refs: Read[] = [];
    for (let j = 0; j < tokens.length; j++) {
      if (j === cte.at || tokens[j]!.lower !== cte.name || tokens[j + 1]?.text === "." || isOrderOrGroupBy(tokens, j)) continue;
      if (j > open && j < close) return undefined; // recursive
      if (tokens[j + 1]?.text === "(" || hasColumnList(a, j)) return undefined;
      refs.push({ at: j, scope: scopes.of[j]!, names: readNames(a, j) });
    }
    return refs;
  }
  if (hasColumnList(a, close)) return undefined;
  const alias = aliasAt(a, close);
  return [{ at: open, scope: scopes.of[open]!, names: new Set(alias === undefined ? [] : [tokens[alias]!.name]) }];
}

/** Clauses that compute over a source's rows, or pick some of them, before an outside filter runs. */
const COMPUTES_OVER_ROWS = new Set(["group", "having", "window", "qualify", "limit", "offset", "fetch", "top", "over"]);

/**
 * Whether the body of the query at `open` passes `column` of the read named `names` through to
 * its output unrenamed, and computes nothing across rows: every select-list item is a plain column
 * (`col` or `q.col`, optionally aliased), `q.*` or `*`; exactly one yields that name, and it is the
 * column itself, the read's `q.*`, or `*` over a single source; and the body has no `GROUP BY`,
 * `HAVING`, window, `LIMIT`, `OFFSET`, `FETCH` or `TOP`, which would run over every tenant's rows
 * before the outside filter. An item with a string or comment in it, `DISTINCT ON` or a nested
 * `WITH` fails closed.
 */
function passesThrough(a: Analysis, open: number, names: ReadonlySet<string>, column: string): boolean {
  const { tokens, scopes, view } = a;
  const scope = scopeKey(open, 0);
  const depth = tokens[open]!.depth + 1;
  const level = (i: number) => scopes.of[i] === scope && tokens[i]!.depth === depth;
  const select = open + 1;
  if (tokens[select]?.kw !== "select") return false;
  let from = select + 1;
  while (from < tokens.length && !(level(from) && tokens[from]!.kw === "from")) from++;
  if (from >= tokens.length) return false;
  let first = select + 1;
  if (tokens[first]?.kw === "all" || tokens[first]?.kw === "distinct") first++;
  if (tokens[first]?.kw === "on") return false;
  const end = scopes.close.get(open) ?? tokens.length;
  for (let i = select; i < end; i++) if (scopes.of[i] === scope && COMPUTES_OVER_ROWS.has(tokens[i]!.kw)) return false;

  const items: number[][] = [[]];
  for (let i = first; i < from; i++) {
    if (level(i) && tokens[i]!.text === ",") items.push([]);
    else items[items.length - 1]!.push(i);
  }
  let yields = 0;
  for (const item of items) {
    if (item.length === 0) return false;
    // Text the view blanked (a string, a comment) could be part of the item, so don't guess.
    const last = tokens[item[item.length - 1]!]!;
    for (let p = tokens[item[0]!]!.offset; p < last.offset + last.text.length; p++) {
      if (view.text[p] !== view.source[p] && view.text[p] !== QUOTE_MARK) return false;
    }
    const ts = item.map((i) => tokens[i]!);
    const n = ts.length;
    if (n === 1 && ts[0]!.text === "*") {
      if (!singleSource(a, open, scope, depth)) return false;
      yields++;
      continue;
    }
    if (n === 3 && ts[1]!.text === "." && ts[2]!.text === "*") {
      if (!names.has(ts[0]!.name)) return false;
      yields++;
      continue;
    }
    let alias: string | undefined;
    let expr = ts;
    if (n >= 3 && ts[n - 2]!.kw === "as" && isWord(ts[n - 1])) {
      alias = ts[n - 1]!.lower;
      expr = ts.slice(0, n - 2);
    } else if (n >= 2 && isWord(ts[n - 1]) && (isWord(ts[n - 2]) || ts[n - 2]!.text === ")" || /^\d/.test(ts[n - 2]!.text))) {
      alias = ts[n - 1]!.lower;
      expr = ts.slice(0, n - 1);
    }
    const isColumn = expr.length === 1 ? isWord(expr[0]) : expr.length === 3 && isWord(expr[0]) && expr[1]!.text === "." && isWord(expr[2]);
    if (!isColumn) return false; // an expression, a call or an aggregate
    const name = expr[expr.length - 1]!.lower;
    if ((alias ?? name) !== column) continue;
    if (name !== column || (expr.length === 3 && !names.has(expr[0]!.name))) return false; // another expression named like the column
    yields++;
  }
  return yields === 1;
}

/** Whether the `FROM` of the query at `open` has one source: no join and no comma before its next clause. */
function singleSource(a: Analysis, open: number, scope: string, depth: number): boolean {
  const { tokens, scopes } = a;
  const end = scopes.close.get(open) ?? tokens.length;
  let i = open + 1;
  while (i < end && !(scopes.of[i] === scope && tokens[i]!.depth === depth && tokens[i]!.kw === "from")) i++;
  for (i++; i < end; i++) {
    const t = tokens[i]!;
    if (scopes.of[i] !== scope || t.depth !== depth) continue;
    if (t.text === "," || JOIN_WORDS.has(t.kw) || (t.text === "(" && !opensQuery(tokens, i))) return false;
    // Only a clause no engine takes as an alias ends the FROM: past `lock` or `qualify`, which
    // may be the first source's alias, a second source can still follow.
    if (ENDS_A_SOURCE.has(t.kw) && !JOIN_WORDS.has(t.kw)) return true;
  }
  return true;
}

/**
 * Whether `read`'s `SELECT` ANDs in `col = '<value>'` for `target.discriminator`: its column
 * (unqualified, or qualified with the read's table or alias), `=`, and a plain `'…'` literal,
 * read from the statement at the offsets where the view blanked it, whose value is one of the
 * discriminator's values and which nothing but whitespace follows up to the next token (no
 * `''`-escape, no adjacent literal, no comment).
 */
function hasDiscriminator(a: Analysis, read: Read, target: PredicateTarget): boolean {
  const { column, values } = target.discriminator!;
  const { tokens, view } = a;
  const source = view.source;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    const eq = tokens[i + 1];
    if (a.scopes.of[i] !== read.scope || !isIdentifier(t) || t.lower !== column.toLowerCase() || eq?.text !== "=") continue;
    const qualifier = qualifierOf(tokens, i);
    if (qualifier !== undefined && !read.names.has(qualifier)) continue;
    let open = eq.offset + 1;
    while (/\s/.test(source[open] ?? "")) open++;
    if (source[open] !== "'") continue;
    const close = source.indexOf("'", open + 1);
    if (close < 0) continue;
    const value = source.slice(open + 1, close);
    if (value.includes("\\") || !values.includes(value)) continue;
    // The view must read it as a string, and it must end there.
    const next = tokens[i + 2]?.offset ?? source.length;
    if (view.text.slice(open, close + 1).trim() !== "" || source.slice(close + 1, next).trim() !== "") continue;
    if (filteredScopes(a, qualifiedStart(tokens, i), i + 1, qualifier).some((f) => f.scope === read.scope)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Proving a read is in scope through joins (#400)
// ---------------------------------------------------------------------------

/** What the policy says about tables and columns, for proving a read is in scope through joins (#400). */
type PolicyGraph = {
  /** Each table's columns that hold a root's IDs, with the placeholders of the roots each one holds. */
  readonly carriers: ReadonlyMap<string, ReadonlyMap<string, ReadonlySet<string>>>;
  /**
   * The foreign keys the policy declares, as hops from one table's column to another's: each join-path
   * step, each hierarchy edge's and root parent's key, and each scope column to its root's ID column.
   */
  readonly hops: ReadonlyArray<{ readonly from: string; readonly fromColumn: string; readonly to: string; readonly toColumn: string }>;
  /** The columns the policy names on each table. */
  readonly columns: ReadonlyMap<string, ReadonlySet<string>>;
  /** Every root's placeholder. */
  readonly placeholders: ReadonlySet<string>;
};

const graphs = new WeakMap<NormalizedTenantPolicy, PolicyGraph>();

function policyGraph(policy: NormalizedTenantPolicy): PolicyGraph {
  let graph = graphs.get(policy);
  if (graph !== undefined) return graph;
  const carriers = new Map<string, Map<string, Set<string>>>();
  const columns = new Map<string, Set<string>>();
  const name = (columnId: string) => [tableOfColumn(columnId).toLowerCase(), extractColumnName(columnId).toLowerCase()] as const;
  const know = (columnId: string) => {
    const [table, column] = name(columnId);
    columns.set(table, (columns.get(table) ?? new Set()).add(column));
  };
  for (const root of policy.roots) {
    for (const carrier of idCarriers(policy, root.id)) {
      const table = carrier.table.toLowerCase();
      const byColumn = carriers.get(table) ?? new Map<string, Set<string>>();
      byColumn.set(carrier.column.toLowerCase(), (byColumn.get(carrier.column.toLowerCase()) ?? new Set()).add(carrier.placeholder));
      carriers.set(table, byColumn);
      columns.set(table, (columns.get(table) ?? new Set()).add(carrier.column.toLowerCase()));
    }
  }
  const hops: Array<PolicyGraph["hops"][number]> = [];
  const hop = (fromId: string, toId: string) => {
    know(fromId);
    know(toId);
    const [from, fromColumn] = name(fromId);
    const [to, toColumn] = name(toId);
    hops.push({ from, fromColumn, to, toColumn });
  };
  const idColumn = (rootId: string) => policy.roots.find((r) => r.id === rootId)?.tenantIdColumn;
  for (const edge of policy.hierarchy) {
    const to = idColumn(edge.parent);
    if (to !== undefined) hop(edge.foreignKey, to);
  }
  for (const root of policy.roots) {
    const to = root.parent ? idColumn(root.parent.root) : undefined;
    if (root.parent && to !== undefined) hop(root.parent.foreignKey, to);
  }
  for (const st of policy.scopedTables) {
    for (const path of st.scopeThrough) {
      if ("column" in path) {
        const to = idColumn(path.root);
        if (to !== undefined) hop(path.column, to);
      } else {
        for (const step of path.join) hop(step.from, step.to);
      }
    }
  }
  graph = { carriers, hops, columns, placeholders: new Set(policy.roots.map((r) => placeholderForTenantRoot(r))) };
  graphs.set(policy, graph);
  return graph;
}

/** A read of a table the policy names. */
type Node = Read & { readonly table: string };

/** A column as written: its qualifier, if any, and its name. */
type ColumnRef = { readonly q: string | undefined; readonly column: string };

/** One view's reads of the policy's tables, the `col = col` conjuncts of each `SELECT`, and the values they bind. */
type Proof = {
  readonly a: Analysis;
  readonly graph: PolicyGraph;
  readonly nodes: readonly Node[];
  readonly equalities: ReadonlyArray<{ readonly left: ColumnRef; readonly right: ColumnRef; readonly scope: string; readonly on?: number }>;
  readonly bound: Map<string, (node: Node, column: string) => ReadonlySet<string>>;
};

const proofs = new WeakMap<Analysis, WeakMap<PolicyGraph, Proof>>();

function proofFor(a: Analysis, graph: PolicyGraph): Proof {
  const byGraph = proofs.get(a) ?? new WeakMap<PolicyGraph, Proof>();
  proofs.set(a, byGraph);
  let proof = byGraph.get(graph);
  if (proof !== undefined) return proof;
  const ctes = new Set([...a.scopes.close.keys()].map((open) => cteNameAt(a.tokens, open)).filter((n) => n !== undefined));
  const nodes = [...graph.columns.keys()]
    .filter((table) => !ctes.has(table))
    .flatMap((table) => readsOf(a, table).filter((read) => isTableReference(a.tokens, read.at)).map((read) => ({ ...read, table })));
  proof = { a, graph, nodes, equalities: equalities(a), bound: new Map() };
  byGraph.set(graph, proof);
  return proof;
}

/**
 * The name of the CTE whose body opens at `open`, with or without a column list (`x AS (`,
 * `x (a, b) AS (`, `x AS MATERIALIZED (`), or undefined when it opens none.
 */
function cteNameAt(tokens: readonly Token[], open: number): string | undefined {
  let k = open - 1;
  if (tokens[k]?.kw === "materialized") k -= tokens[k - 1]?.kw === "not" ? 2 : 1;
  if (tokens[k]?.kw !== "as") return undefined;
  k--;
  if (tokens[k]?.text === ")") {
    const list = tokens[k - 1]?.text === "(" ? k - 1 : enclosing(tokens, k - 1, "(");
    if (list < 0 || tokens[list]!.depth !== tokens[k]!.depth) return undefined;
    k = list - 1;
  }
  const before = tokens[k - 1];
  if (!isWord(tokens[k]) || !(before?.kw === "with" || before?.kw === "recursive" || before?.text === ",")) return undefined;
  return tokens[k]!.lower;
}

/**
 * Whether the `FROM` at `k` opens its `SELECT`'s own `FROM` clause: not `IS [NOT] DISTINCT FROM`,
 * and not a `FROM` inside a call's parentheses (`EXTRACT(YEAR FROM d)`, `TRIM(BOTH FROM s)`).
 */
function opensFromClause(tokens: readonly Token[], k: number): boolean {
  if (tokens[k]?.kw !== "from" || tokens[k - 1]?.kw === "distinct") return false;
  const open = enclosing(tokens, k, "(");
  return open < 0 || opensQuery(tokens, open);
}

/**
 * Whether the name at `i` is a table read in a `FROM` clause: written right after a `SELECT`'s own
 * `FROM`, after `JOIN` or MySQL's `STRAIGHT_JOIN`, after the `(` of a parenthesized join group in
 * one of those places, or after a comma of that `FROM` list (joins included), after any schema
 * qualifier, and not a function's name. The alias of a derived table, of a table function or of
 * another table is not, so the policy's columns are never trusted on a source that only borrows a
 * table's name (#400).
 */
function isTableReference(tokens: readonly Token[], i: number): boolean {
  if (tokens[i + 1]?.text === "(") return false;
  return startsSource(tokens, qualifiedStart(tokens, i));
}

/** Whether a row source can start at `start`: see {@link isTableReference}. */
function startsSource(tokens: readonly Token[], start: number): boolean {
  const before = tokens[start - 1];
  if (before?.kw === "join" || before?.kw === "straight_join") return true;
  if (before?.kw === "from") return opensFromClause(tokens, start - 1);
  if (before?.text === "(") return !opensQuery(tokens, start - 1) && startsSource(tokens, start - 1);
  if (before?.text !== ",") return false;
  const depth = before.depth;
  for (let k = start - 2; k >= 0; k--) {
    const t = tokens[k]!;
    if (t.depth < depth) return false;
    if (t.depth > depth) continue;
    if (t.kw === "from") return opensFromClause(tokens, k);
    // A join's words and its `ON` are part of the `FROM` list; any other clause ends it.
    if (t.kw === "select" || t.kw === "where" || t.kw === "having" || (CLAUSE_END.has(t.kw) && !JOIN_WORDS.has(t.kw))) return false;
  }
  return false;
}

/**
 * The `col = col` terms ANDed into a `WHERE`, `ON` or `HAVING` clause, with their `SELECT`. An outer
 * join's `ON` counts here: an equality only links two reads, and a row it doesn't link has nulls on one
 * side, which a filter elsewhere in the `SELECT` (never an outer join's `ON`) has to pass.
 */
function equalities(a: Analysis): Proof["equalities"] {
  const { tokens } = a;
  const found: Array<Proof["equalities"][number]> = [];
  tokens.forEach((t, i) => {
    if (t.text !== "=" || !tokens[i - 1] || !isIdentifier(tokens[i - 1]!) || !tokens[i + 1] || !isIdentifier(tokens[i + 1]!)) return;
    let end = i + 1;
    while (tokens[end + 1]?.text === "." && tokens[end + 2] !== undefined && isIdentifier(tokens[end + 2]!)) end += 2;
    const left = { q: qualifierOf(tokens, i - 1), column: tokens[i - 1]!.lower };
    const right = { q: qualifierOf(tokens, end), column: tokens[end]!.lower };
    for (const f of filteredScopes(a, qualifiedStart(tokens, i - 1), end, undefined, true)) found.push({ left, right, scope: f.scope, on: f.on });
  });
  return found;
}

/**
 * Whether an equality in the `ON` at `on` holds for every row of the reads it names. Outside an
 * `ON`, and in a `SELECT` with no outer join, it does. Beside an outer join, a row of the side
 * the join keeps has it hold only when the join matched, so an `ON` equality links only a column
 * of the item joined there (between its `JOIN` and that `ON`) with one outside it: rows that fail
 * it lose the joined item, and a filter on the joined item drops those rows. Two columns on the
 * same side (`ON o.agency_id = o.id`) link nothing (#400).
 */
function linksAcross(p: Proof, scope: string, on: number | undefined, l: Node, r: Node): boolean {
  const { tokens } = p.a;
  if (on === undefined || !(isOuterJoinOn(tokens, on) || hasOuterJoin(p.a, scope))) return true;
  let join = on - 1;
  while (join >= 0 && !(tokens[join]!.kw === "join" && tokens[join]!.depth === tokens[on]!.depth)) {
    if (tokens[join]!.depth < tokens[on]!.depth) return false;
    join--;
  }
  const joined = (n: Node) => n.at > join && n.at < on;
  return join >= 0 && joined(l) !== joined(r);
}

/**
 * The read a column refers to in `scope`: the one its qualifier names, or, unqualified, the one
 * whose table the policy says has the column. Another source with the same column would make the
 * SQL ambiguous, so it can't name a different one. Undefined when no single read fits.
 */
function resolve(p: Proof, scope: string, ref: ColumnRef): Node | undefined {
  const hits = p.nodes.filter((n) => n.scope === scope && (ref.q !== undefined ? n.names.has(ref.q) : p.graph.columns.get(n.table)?.has(ref.column)));
  return hits.length === 1 ? hits[0] : undefined;
}

/**
 * The placeholders whose IDs each column of a read holds in `scope`: a column compared with a
 * placeholder (`= P`, `IN (P)`, `= ANY(P)`), ANDed into a filter clause, holds its root's IDs; so does
 * a column equal to one that does, through `col = col` conjuncts; and so does `col IN (SELECT x …)`
 * when the subquery's `x` does in its own `SELECT`.
 */
function boundIn(p: Proof, scope: string): (node: Node, column: string) => ReadonlySet<string> {
  const cached = p.bound.get(scope);
  if (cached !== undefined) return cached;
  const { a } = p;
  const { tokens, scopes } = a;
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.has(r) && parent.get(r) !== r) r = parent.get(r)!;
    parent.set(x, r);
    return r;
  };
  const term = (node: Node, column: string) => `${node.at}.${column}`;
  for (const eq of p.equalities) {
    if (eq.scope !== scope) continue;
    const l = resolve(p, scope, eq.left);
    const r = resolve(p, scope, eq.right);
    if (l && r && linksAcross(p, scope, eq.on, l, r)) parent.set(find(term(l, eq.left.column)), find(term(r, eq.right.column)));
  }
  const seeds = new Map<string, Set<string>>();
  const seed = (key: string, placeholders: Iterable<string>) => {
    const root = find(key);
    seeds.set(root, new Set([...(seeds.get(root) ?? []), ...placeholders]));
  };
  tokens.forEach((t, k) => {
    if (!p.graph.placeholders.has(t.text)) return;
    const predicate = predicateAt(tokens, k);
    if (!predicate) return;
    const ref = { q: qualifierOf(tokens, predicate.column), column: tokens[predicate.column]!.lower };
    if (!filteredScopes(a, predicate.start, predicate.end, ref.q).some((f) => f.scope === scope)) return;
    const node = resolve(p, scope, ref);
    if (node) seed(term(node, ref.column), [t.text]);
  });
  for (const link of inLinks(p, scope)) {
    const node = resolve(p, scope, link.ref);
    if (link.inner && node) seed(term(node, link.ref.column), boundIn(p, link.innerScope)(link.inner, link.item.column));
  }
  const lookup = (node: Node, column: string): ReadonlySet<string> => seeds.get(find(term(node, column))) ?? new Set();
  p.bound.set(scope, lookup);
  return lookup;
}

/**
 * Each `col IN (SELECT x …)` ANDed into a filter clause of `scope`, over a subquery with no set
 * operation that selects one plain column: `col` as written, the subquery's `SELECT`, the column it
 * selects, and the read that column resolves to there, if any.
 */
function inLinks(p: Proof, scope: string): Array<{ ref: ColumnRef; innerScope: string; item: ColumnRef; inner: Node | undefined }> {
  const { tokens, scopes } = p.a;
  const links: Array<{ ref: ColumnRef; innerScope: string; item: ColumnRef; inner: Node | undefined }> = [];
  for (const [open, close] of scopes.close) {
    const column = open - 2;
    if (scopes.of[column] !== scope || scopes.branched.has(open) || subqueryUse(tokens, open) !== "in") continue;
    const ref = { q: qualifierOf(tokens, column), column: tokens[column]!.lower };
    if (!filteredScopes(p.a, qualifiedStart(tokens, column), close, ref.q).some((f) => f.scope === scope)) continue;
    const item = selectedColumn(p.a, open);
    if (item === undefined) continue;
    const innerScope = scopeKey(open, 0);
    links.push({ ref, innerScope, item, inner: resolve(p, innerScope, item) });
  }
  return links;
}

/**
 * The reads that `node`'s `hop` links it to in its `SELECT`: a conjunct `node.fromColumn = y.toColumn`
 * (either way round), or `node.fromColumn IN (SELECT y.toColumn …)`, where `y` reads the hop's table.
 */
function hopTargets(p: Proof, node: Node, hop: PolicyGraph["hops"][number]): Node[] {
  const { tokens, scopes } = p.a;
  const targets: Node[] = [];
  for (const eq of p.equalities) {
    if (eq.scope !== node.scope) continue;
    for (const [mine, theirs] of [[eq.left, eq.right], [eq.right, eq.left]] as const) {
      if (mine.column !== hop.fromColumn || theirs.column !== hop.toColumn || resolve(p, node.scope, mine)?.at !== node.at) continue;
      const y = resolve(p, node.scope, theirs);
      if (y?.table === hop.to) targets.push(y);
    }
  }
  for (const link of inLinks(p, node.scope)) {
    if (link.ref.column !== hop.fromColumn || resolve(p, node.scope, link.ref)?.at !== node.at) continue;
    if (link.item.column === hop.toColumn && link.inner?.table === hop.to) targets.push(link.inner);
  }
  return targets;
}

/**
 * Whether `node` reads only rows within the scope of the roots whose placeholders are `allowed`
 * (#400): a column of its table that holds an allowed root's IDs (by the policy) is bound to that
 * root's placeholder in its `SELECT` (see {@link boundIn}), or a foreign key the policy declares links
 * it, on exactly the declared columns, to a read that is itself within that scope. A join on any
 * other pair of columns links nothing.
 */
function inScope(p: Proof, node: Node, allowed: ReadonlySet<string>, visited: Set<number> = new Set([node.at])): boolean {
  const bound = boundIn(p, node.scope);
  for (const [column, holds] of p.graph.carriers.get(node.table) ?? []) {
    for (const placeholder of bound(node, column)) if (holds.has(placeholder) && allowed.has(placeholder)) return true;
  }
  for (const hop of p.graph.hops) {
    if (hop.from !== node.table) continue;
    for (const next of hopTargets(p, node, hop)) {
      if (visited.has(next.at)) continue;
      visited.add(next.at);
      if (inScope(p, next, allowed, visited)) return true;
    }
  }
  return false;
}

/**
 * The column the query at `open` selects, when its select list is one plain column (`col` or
 * `q.col`, under any alias), else undefined.
 */
function selectedColumn(a: Analysis, open: number): ColumnRef | undefined {
  const { tokens, scopes, view } = a;
  const scope = scopeKey(open, 0);
  const depth = tokens[open]!.depth + 1;
  if (tokens[open + 1]?.kw !== "select") return undefined;
  let first = open + 2;
  if (tokens[first]?.kw === "all" || tokens[first]?.kw === "distinct") first++;
  let from = first;
  while (from < tokens.length && !(scopes.of[from] === scope && tokens[from]!.depth === depth && tokens[from]!.kw === "from")) from++;
  const item = tokens.slice(first, from);
  if (item.length === 0 || from >= tokens.length || item.some((t) => t.text === ",")) return undefined;
  const last = item[item.length - 1]!;
  for (let at = item[0]!.offset; at < last.offset + last.text.length; at++) {
    if (view.text[at] !== view.source[at] && view.text[at] !== QUOTE_MARK) return undefined;
  }
  const n = item[1]?.text === "." ? 3 : 1;
  const rest = item.slice(n);
  const aliased = rest.length === 0 || (rest.length === 1 && isWord(rest[0])) || (rest.length === 2 && rest[0]!.kw === "as" && isWord(rest[1]));
  if (!aliased || !isIdentifier(item[n - 1]!) || (n === 3 && !isWord(item[0]))) return undefined;
  return { q: n === 3 ? item[0]!.name : undefined, column: item[n - 1]!.lower };
}

/** An identifier token: a word that isn't one of the predicate forms' keywords. */
function isIdentifier(token: Token): boolean {
  return /^[A-Za-z_\u0080-\uffff]/.test(token.text) && !PREDICATE_WORDS.has(token.kw);
}

/**
 * A clause keyword used as a function name (`LEFT(status, 1)`, `RIGHT(…)`) is an identifier.
 * A set operator never is: `UNION (SELECT …)` opens a parenthesized operand.
 */
function isFunctionCall(tokens: readonly Token[], i: number): boolean {
  return tokens[i + 1]?.text === "(" && isIdentifier(tokens[i]!) && !SET_OPERATORS.has(tokens[i]!.kw);
}

/** Start index of a possibly qualified column (`o.agency_id`, `s.o.agency_id`) that ends at `end`. */
function qualifiedStart(tokens: readonly Token[], end: number): number {
  let start = end;
  while (tokens[start - 1]?.text === "." && tokens[start - 2] !== undefined && isIdentifier(tokens[start - 2]!)) start -= 2;
  return start;
}

/**
 * The span `[start, end]` and column index of a tenant predicate around the placeholder at `k`:
 * `col = P`, `P = col`, `col IN (P)` or `col = ANY (P)`, where `col` (the last part of a possibly
 * qualified name) is `column`, or any column when none is given. Which read the column belongs to
 * is its qualifier's to say.
 */
function predicateAt(tokens: readonly Token[], k: number, column?: string): { start: number; end: number; column: number } | undefined {
  const at = (i: number) => tokens[i];
  const name = column?.toLowerCase();
  const matches = (i: number) => {
    const t = at(i);
    return t !== undefined && isIdentifier(t) && (name === undefined || t.lower === name);
  };
  // col = P
  if (at(k - 1)?.text === "=" && matches(k - 2)) return { start: qualifiedStart(tokens, k - 2), end: k, column: k - 2 };
  const closed = at(k + 1)?.text === ")";
  // col IN ( P )
  if (closed && at(k - 1)?.text === "(" && at(k - 2)?.kw === "in" && matches(k - 3)) {
    return { start: qualifiedStart(tokens, k - 3), end: k + 1, column: k - 3 };
  }
  // col = ANY ( P )
  if (closed && at(k - 1)?.text === "(" && at(k - 2)?.kw === "any" && at(k - 3)?.text === "=" && matches(k - 4)) {
    return { start: qualifiedStart(tokens, k - 4), end: k + 1, column: k - 4 };
  }
  // P = col
  if (at(k + 1)?.text === "=") {
    let end = k + 2;
    while (at(end + 1)?.text === "." && at(end + 2) !== undefined && isIdentifier(at(end + 2)!)) end += 2;
    if (matches(end)) return { start: k, end, column: end };
  }
  return undefined;
}

/** How a parenthesized query block is used by the query around it. */
type SubqueryUse = "table" | "in" | "other";

/**
 * Whether the subquery opened by the `(` at `open` is a row source (a derived table in
 * `FROM`/`JOIN`, a CTE body after `AS`), the right side of `col IN (…)`, or anything else.
 * `EXISTS (…)` is "other": its filter limits the subquery's rows, not the outer query's.
 * A parenthesized statement, or a parenthesized operand of a set operation (after `(`,
 * or after `UNION`/`INTERSECT`/`EXCEPT`/`MINUS` [`ALL`|`DISTINCT`]), produces the rows of
 * the query around it, so it is used however that query is.
 */
function subqueryUse(tokens: readonly Token[], open: number): SubqueryUse {
  const opener = tokens[open - 1];
  const setOperand =
    opener !== undefined &&
    (SET_OPERATORS.has(opener.kw) ||
      ((opener.kw === "all" || opener.kw === "distinct") && SET_OPERATORS.has(tokens[open - 2]?.kw ?? "")));
  if (opener === undefined || opener.text === "(" || setOperand) {
    const around = opener?.text === "(" ? open - 1 : enclosing(tokens, open, "(");
    if (around < 0) return "table"; // the statement itself
    // `col IN ((…))`: the caller reads `col IN` right before the subquery, so don't claim it.
    const use = subqueryUse(tokens, around);
    return use === "in" ? "other" : use;
  }
  if (opener.kw === "in") return tokens[open - 2] !== undefined && isIdentifier(tokens[open - 2]!) ? "in" : "other";
  if (opener.kw === "as" || opener.kw === "lateral") return "table";
  // A CTE body after `AS MATERIALIZED (` or `AS NOT MATERIALIZED (`.
  if (opener.kw === "materialized" && (tokens[open - 2]?.kw === "as" || (tokens[open - 2]?.kw === "not" && tokens[open - 3]?.kw === "as"))) return "table";
  const depth = tokens[open]!.depth;
  for (let i = open - 1; i >= 0; i--) {
    const t = tokens[i]!;
    if (t.depth < depth) return "other";
    if (t.depth > depth) continue;
    // OUTER APPLY keeps every left-side row, like an outer join; CROSS APPLY filters.
    if (t.kw === "apply") return tokens[i - 1]?.kw === "outer" ? "other" : "table";
    if (t.kw === "from" || t.kw === "join") return "table";
    if (t.text !== "," && !(isIdentifier(t) && !CLAUSE_END.has(t.kw) && !NOT_A_FILTER.has(t.kw))) return "other";
  }
  return "other";
}

/** SQL Server join hints, written between the join kind and `JOIN` (`LEFT HASH JOIN`). */
const JOIN_HINTS = new Set(["loop", "hash", "merge", "remote"]);

/** Whether the `ON` at `on` belongs to an outer join, whose `ON` doesn't filter the preserved side. */
function isOuterJoinOn(tokens: readonly Token[], on: number): boolean {
  const depth = tokens[on]!.depth;
  for (let i = on - 1; i >= 0; i--) {
    const t = tokens[i]!;
    if (t.depth < depth) return false;
    if (t.depth > depth || t.kw !== "join") continue;
    let kind = i - 1;
    if (JOIN_HINTS.has(tokens[kind]?.kw ?? "")) kind--;
    if (tokens[kind]?.kw === "outer") kind--;
    return ["left", "right", "full"].includes(tokens[kind]?.kw ?? "");
  }
  return false;
}

/**
 * The `SELECT` whose reads the term `tokens[start..end]` filters (#399), with `qualifier`, its
 * column's, which ties it to a read there: none, or one. The term must be ANDed into a `WHERE`,
 * `ON` (of an inner join, or of any join with `outerOn`) or `HAVING` clause: at its own level and
 * at every enclosing parenthesized level up to that clause, it sits between `AND`s (or the clause's
 * start and end), with no `OR`, `XOR` (or MySQL's `||`) at that level and no `NOT` in front of it.
 * A level opened by a function call or a comparison doesn't count. A `SELECT` used as `col IN (…)`
 * limits the query around it only through the join {@link inScope} follows (#400).
 */
function filteredScopes(a: Analysis, start: number, end: number, qualifier: string | undefined, outerOn = false): Filter[] {
  const { tokens, scopes } = a;
  const disjunction = (t: Token) => t.kw === "or" || t.kw === "xor" || (t.text === "||" && a.view.reading.pipesAreOr);
  const endsClause = (i: number) => CLAUSE_END.has(tokens[i]!.kw) && !isFunctionCall(tokens, i);
  const filters: Filter[] = [];
  let lo = start;
  let hi = end;
  let depth = tokens[start]!.depth;
  for (;;) {
    // What is directly around the term, at its level.
    const before = tokens[lo - 1];
    const after = tokens[hi + 1];
    const leftOk = before !== undefined && (before.kw === "and" || before.text === "(" || FILTER_CLAUSE.has(before.kw));
    // A `,` ends a join's `ON` when another source follows in the `FROM` list; elsewhere the opener check below refuses it.
    const rightOk = after === undefined || after.kw === "and" || after.text === ")" || after.text === ";" || after.text === "," || endsClause(hi + 1);
    if (!leftOk || !rightOk) return filters;

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
      if (disjunction(t) || t.kw === "not") return filters;
      if (FILTER_CLAUSE.has(t.kw)) {
        clause = i;
        break;
      }
      if ((endsClause(i) || NOT_A_FILTER.has(t.kw)) && !isFunctionCall(tokens, i)) return filters;
    }
    let close = tokens.length;
    for (let j = hi + 1; j < tokens.length; j++) {
      const t = tokens[j]!;
      if (t.depth < depth) {
        close = j; // the ")" closing this level
        break;
      }
      if (t.depth > depth) continue;
      if (t.text === ";" || t.text === "," || endsClause(j)) break;
      if (disjunction(t)) return filters;
    }

    if (clause >= 0) {
      // An outer join keeps rows its ON doesn't match, and in a SELECT with one, an inner join's ON
      // filters only the rows that join builds; there only WHERE and HAVING filter every row (#400).
      if (!outerOn && tokens[clause]!.kw === "on" && (isOuterJoinOn(tokens, clause) || hasOuterJoin(a, scopes.of[clause]!))) return filters;
      filters.push(tokens[clause]!.kw === "on" ? { scope: scopes.of[clause]!, qualifier, on: clause } : { scope: scopes.of[clause]!, qualifier });
      return filters;
    }

    if (open < 0 || tokens[open]!.text !== "(" || close >= tokens.length || tokens[close]!.text !== ")") return filters;
    // A parenthesized group counts only as a plain boolean conjunct: opened right after
    // WHERE/ON/HAVING, AND, or another "(". Anything else (`f(`, `IN (`, `EXISTS (`,
    // `NOT (`, `= (`) makes it something other than a filter conjunct.
    const opener = tokens[open - 1];
    if (opener === undefined || !(FILTER_CLAUSE.has(opener.kw) || opener.kw === "and" || opener.text === "(")) return filters;
    lo = open;
    hi = close;
    depth = tokens[open]!.depth;
  }
}

/**
 * Whether a `SELECT` has an outer join (`LEFT`, `RIGHT` or `FULL`, nested or in parentheses
 * included) or an `OUTER APPLY`. Its rows then include ones that an inner join's `ON` never saw.
 */
function hasOuterJoin(a: Analysis, scope: string): boolean {
  const { tokens, scopes } = a;
  return tokens.some((t, i) => {
    if (scopes.of[i] !== scope) return false;
    if (t.kw === "apply") return tokens[i - 1]?.kw === "outer";
    if (t.kw !== "join") return false;
    let kind = i - 1;
    if (JOIN_HINTS.has(tokens[kind]?.kw ?? "")) kind--;
    if (tokens[kind]?.kw === "outer") kind--;
    return ["left", "right", "full"].includes(tokens[kind]?.kw ?? "");
  });
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
