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
import {
  mayBeSqlite,
  readSql,
  QUERY_START_WORDS,
  stringsSqliteReadsAsNames,
  tenantCodeReadings,
  tenantStatementReadings,
  unmatchedNonAsciiName,
  type CodeViewReading,
  type SqlRead,
} from "./readings.js";
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
 * needs the same predicate on its tenant ID column. Down a join path, the predicate
 * must be on a column that carries the IDs of the path's root or one of its ancestors
 * in the hierarchy. A polymorphic table also needs `typeColumn = '<key>'` ANDed into
 * the same `SELECT`, with a `mapping` key of the root whose placeholder filters
 * its id column. Each read of a table needs its own predicate in its own `SELECT`
 * (#399): a CTE body, a derived table and a subquery are each their own, and a
 * qualified predicate counts only for the read its qualifier names. A read in a
 * derived table or CTE also counts as filtered when every reference to that source
 * is filtered on the column, which the source passes through unrenamed without
 * computing across its rows. It doesn't
 * check which columns a join or an `IN (…)` subquery equates (#400); database-side
 * row-level security is the sound boundary.
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
 * `schemaNames` are the schema's table, namespace and column names, when the caller has the
 * schema: a name outside printable ASCII counts when it is one of them or a name in the policy.
 */
export function tenantRuleWarnings(
  sql: string,
  policy: NormalizedTenantPolicy,
  scope: TenantScope,
  dialect: ValidateTenantGuardrailsOptions["dialect"] | undefined,
  schemaNames?: ReadonlySet<string>,
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

  // The checks below match names by spelling. SQL Server reads a name through the database
  // collation, which ignores some characters and reads others as ASCII letters, so a name outside
  // printable ASCII may reach a table they never see: unless the schema spells it exactly, refuse it.
  const folded = unmatchedNonAsciiName(read, dialect, knownNames(policy, schemaNames));
  if (folded !== undefined) {
    warnings.push(
      warn("UNICODE_ESCAPED_IDENTIFIER", "",
        `The SQL uses the name ${folded}, which has a character outside printable ASCII and isn't spelled that way in the schema. ` +
        "SQL Server reads names through its collation, which ignores some characters and reads others as ASCII letters, so the " +
        "tenant check can't tell which table or column it names. Spell the name exactly as the schema does."),
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

  // On a Postgres reading the lexer reads `$1OR` as one parameter, while PostgreSQL 14 and earlier
  // and CockroachDB end the parameter at its last digit and read the word as a keyword the checks
  // below would miss. Refuse it rather than guess how the server splits it (GHSA-rhwf-7742-8hwj).
  const glued = parameterAgainstWord(read, dialect);
  if (glued !== undefined) {
    warnings.push(
      warn("NOT_SELECT_OR_WITH", "",
        `The SQL writes a word right after a parameter ('${glued}'), which PostgreSQL 14 and CockroachDB read as a separate ` +
        "keyword, so the tenant check can't tell which words are keywords. Put a space after the parameter."),
    );
  }

  const views = codeViews(read, dialect);

  // Check the roots this scope covers: a query on the root table itself is scoped by its tenant ID column.
  for (const rootId of scopeRootIds(scope)) {
    const root = policy.roots.find((r) => r.id === rootId);
    if (!root || !mentionsTable(views, extractTableName(root.id))) continue;
    const column = extractColumnName(root.tenantIdColumn);
    // Filtered on its own tenant ID column, or on a column that carries its IDs (a query
    // that joins the root for a label, filtered on the scoped table's tenant column).
    if (!hasTenantPredicate(views, extractTableName(root.id), idCarriers(policy, root.id))) {
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
  for (const path of st.scopeThrough) {
    const placeholder = placeholderFor(policy, path.root);
    if ("column" in path) {
      // The table's tenant column compared with its root's placeholder.
      if (hasTenantPredicate(sql, table, [{ placeholder, column: extractColumnName(path.column), table }])) return;
    } else {
      // Inherited via JOINs: every join column appears, and a tenant predicate filters
      // the root: on its tenant ID column, or, up the hierarchy, on a column that carries
      // the IDs of one of its ancestors. A root outside that chain filters nothing here,
      // even one the scope binds.
      const allStepsPresent = path.join.every(
        (step) => mentionsIdentifier(sql, extractColumnName(step.from)) && mentionsIdentifier(sql, extractColumnName(step.to)),
      );
      if (!allStepsPresent) continue;
      const targets = selfAndAncestors(policy, path.root).flatMap((rootId) => idCarriers(policy, rootId));
      if (hasTenantPredicate(sql, table, targets)) return;
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

/**
 * The names a statement may spell outside printable ASCII: every table the policy covers and its
 * namespace, every column the policy names, and `schemaNames` when the caller has the schema.
 */
function knownNames(policy: NormalizedTenantPolicy, schemaNames: ReadonlySet<string> | undefined): ReadonlySet<string> {
  const names = new Set(schemaNames);
  const table = (id: string) => {
    const path = id.replace(/^table:/, "");
    const dot = path.lastIndexOf(".");
    names.add(path.slice(dot + 1));
    if (dot !== -1) names.add(path.slice(0, dot));
  };
  const column = (id: string) => {
    const hash = id.lastIndexOf("#");
    if (hash !== -1) table(id.slice(0, hash));
    names.add(extractColumnName(id));
  };
  for (const entry of policy.coverage) table(entry.tableId);
  for (const id of policy.globalTables) table(id);
  for (const root of policy.roots) {
    table(root.id);
    column(root.tenantIdColumn);
    if (root.parent) column(root.parent.foreignKey);
  }
  for (const edge of policy.hierarchy) column(edge.foreignKey);
  for (const st of policy.scopedTables) {
    table(st.id);
    for (const path of st.scopeThrough) {
      if ("column" in path) column(path.column);
      else {
        for (const step of path.join) {
          column(step.from);
          column(step.to);
        }
      }
    }
  }
  for (const pt of policy.polymorphicTables) {
    table(pt.id);
    column(pt.typeColumn);
    column(pt.idColumn);
  }
  return names;
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
 * The first `$N` parameter with a word written right after its digits (`$1OR`) under a reading
 * from `tenantStatementReadings` on the Postgres lexer, where the lexer reads both as one token.
 */
function parameterAgainstWord(read: SqlRead, dialect: ValidateTenantGuardrailsOptions["dialect"] | undefined): string | undefined {
  for (const profile of tenantStatementReadings(dialect)) {
    if (profile.id !== "postgres") continue;
    const token = read.tokens(profile).find((t) => t.kind === "parameter" && /^\$\d+\D/.test(t.text));
    if (token) return token.text.slice(0, 40);
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
 * readable at the same offsets, the shared lexer's tokens under that reading, and which offsets
 * lie inside a name the view reads as quoted (`quoted`, 1 for each).
 */
type CodeViews = ReadonlyArray<{
  readonly text: string;
  readonly source: string;
  readonly reading: CodeViewReading;
  readonly tokens: readonly SqlToken[];
  readonly quoted: Uint8Array;
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
    // A reading that may be SQLite's reads a '…' in a table's place as the table's name, and one right
    // after a table or CTE reference as its alias.
    const names = mayBeSqlite(reading.profile) ? stringsSqliteReadsAsNames(tokens, true) : new Set<number>();
    const quoted = new Uint8Array(read.sql.length);
    tokens.forEach((token, i) => {
      if (token.kind === "quoted_identifier" || names.has(i)) quoted.fill(1, token.start, token.end);
    });
    return { text: codeView(read.sql, tokens, names), source: read.sql, reading, tokens, quoted };
  });
}

/**
 * What a quoted identifier's delimiters become in a code view: not a word character, so
 * identifier matching still sees `"agency_id"` as `agency_id`. The tokenizer skips it, and
 * tells a quoted `"where"` (an identifier) from the keyword `WHERE` by the lexer's spans.
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
 * `agency_id` on Postgres, and blanking it would hide `FROM "orders"` from the table check. The
 * strings at the indices in `names` are read the same way, as SQLite reads them (`FROM 'orders'`).
 */
function codeView(sql: string, tokens: readonly SqlToken[], names: ReadonlySet<number>): string {
  const out = sql.split("");
  for (const [index, token] of tokens.entries()) {
    if (names.has(index)) {
      for (let k = token.start; k < token.end; k++) if (sql[k] === "'") out[k] = QUOTE_MARK;
    } else if (token.kind === "string" || token.kind === "comment") {
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
 * unquoted), and the `BY` after them is the keyword. A `.` before the word makes it a name even with
 * whitespace or a comment (blanked in the view) between them, as every engine reads `billing . order`.
 */
function inOrderOrGroupBy(text: string, start: number, end: number): boolean {
  const afterDot = (at: number) => /\.\s*$/.test(text.slice(0, at));
  if (afterDot(start)) return false;
  const word = text.slice(start, end).toLowerCase();
  if (word === "order" || word === "group") return /^\s+by(?![\w$\u0080-\uffff])/i.test(text.slice(end));
  if (word !== "by") return false;
  const before = /(?:order|group)\s+$/i.exec(text.slice(0, start));
  if (before === null || /[\w$\u0080-\uffff\u0001]/.test(text[before.index - 1] ?? "")) return false;
  return !afterDot(before.index);
}

/**
 * Whether a reading sees `tableName` as a name of its own, not part of a longer one (`orders$archive`):
 * anywhere in code, or inside a quoted name, except as a word of `ORDER BY` or `GROUP BY`.
 */
function mentionsAsName(view: CodeViews[number], tableName: string): boolean {
  const pattern = new RegExp(`(?<![\\w$\\u0080-\\uffff])${escapeRegex(tableName)}(?![\\w$\\u0080-\\uffff])`, "gi");
  return [...view.text.matchAll(pattern)].some((m) => !inOrderOrGroupBy(view.text, m.index, m.index + m[0].length));
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
  /** Lower-cased for keyword comparison; empty for a quoted identifier, which is never a keyword or a placeholder. */
  readonly kw: string;
  /** Parenthesis nesting of the token; a `(` or `)` has the depth outside it. */
  readonly depth: number;
  /** Offset of the token in the statement (a code view keeps the statement's offsets). */
  readonly offset: number;
  /** A quoted identifier: always a name, whatever its characters. */
  readonly quoted?: true;
};

const TOKEN = /:[A-Za-z0-9_]+|::|\|\||<>|!=|<=|>=|[A-Za-z_\u0080-\uffff][\w$\u0080-\uffff]*|\d[\w.]*|\S/g;
/** A {@link TOKEN} match that is a word or a number. */
const WORD_OR_NUMBER = /^[\w\u0080-\uffff]/;

/**
 * Split a code view into tokens with their nesting depth. Strings and comments are already blanked.
 * A quoted identifier is one token, its whole name as the lexer reads it (escapes undone), so a
 * space, dot or bracket inside it is never read as code, and a QUOTE_MARK character written inside
 * it changes nothing. So is a string the reading takes as a name, as SQLite does (`FROM 'orders'`,
 * `orders 'o'`): `'join'` there is a name, never the keyword.
 */
function tokenize(view: CodeViews[number]): Token[] {
  const tokens: Token[] = [];
  const split = lexerWordEnds(view);
  const foldsCase = view.reading.profile.id === "postgres" || view.reading.profile.id === "generic";
  const quotedAt = new Map<number, { readonly end: number; readonly name: string }>();
  for (const t of view.tokens) {
    if (t.kind === "quoted_identifier") quotedAt.set(t.start, { end: t.end, name: t.value });
    else if (t.kind === "string" && view.quoted[t.start] === 1 && t.text.startsWith("'") && t.unterminated !== true) {
      quotedAt.set(t.start, { end: t.end, name: t.text.slice(1, -1).replaceAll("''", "'") });
    }
  }
  let depth = 0;
  let skipUntil = 0;
  for (const m of view.text.matchAll(TOKEN)) {
    if (m.index < skipUntil) continue;
    if (m[0] === QUOTE_MARK) {
      const q = quotedAt.get(m.index);
      if (q === undefined) continue;
      const name = q.name;
      // A name spelled like a mark (`"."`, `[,]`) keeps a prefix, so it never reads as that mark.
      const text = /^[^\w\u0080-\uffff]{1,2}$/.test(name) ? QUOTE_MARK + name : name;
      tokens.push({ text, lower: name.toLowerCase(), name, kw: "", depth, offset: m.index + 1, quoted: true });
      skipUntil = q.end;
      continue;
    }
    for (const [t, offset] of WORD_OR_NUMBER.test(m[0]) ? split(m[0], m.index) : [[m[0], m.index] as const]) {
      if (t === ")") depth = Math.max(0, depth - 1);
      const lower = t.toLowerCase();
      const name = foldsCase ? t.replace(/[A-Z]+/g, (s) => s.toLowerCase()) : t;
      tokens.push({ text: t, lower, name, kw: lower, depth, offset });
      if (t === "(") depth++;
    }
  }
  return tokens;
}

/**
 * Where a word or number of the view ends under its reading (#623, GHSA-rhwf-7742-8hwj), so a
 * keyword written right after one is a word of its own, as the engine reads it:
 *
 * - SQL Server: wherever the shared lexer ends a token. That is after `0x` or `1E`, after a number
 *   before a word, and at whitespace such as U+00A0.
 * - PostgreSQL and CockroachDB: after a number, before a word written right after it (`1OR`,
 *   `1.0OR`), as PostgreSQL 14 and earlier read it. A `$N` parameter written against a word
 *   (`$1OR`) is refused instead ({@link parameterAgainstWord}).
 * - MySQL and MariaDB: after a number with a decimal point or an exponent (`1.0OR`, `1e1OR`). A
 *   name that starts with digits (`3d_models`, `1OR`) is one name there.
 *
 * Any other reading keeps the check's own word ends. Returns a function that cuts a word or number
 * of the view at those ends; under SQL Server it also drops the characters the lexer reads as
 * whitespace. A quoted name is one lexer token, so it is never cut.
 */
function lexerWordEnds(view: CodeViews[number]): (text: string, offset: number) => Array<readonly [string, number]> {
  const { profile } = view.reading;
  const owner = new Int32Array(view.text.length).fill(-1);
  if (profile.tsqlLiterals) {
    view.tokens.forEach((token, index) => owner.fill(index, token.start, token.end));
  } else {
    // Every character is code to this reading; a new piece starts only at a number's end.
    owner.fill(0);
    let piece = 0;
    view.tokens.forEach((token, index) => {
      const next = view.tokens[index + 1];
      const wordAfter = next !== undefined && next.start === token.end && next.kind === "word";
      const numberEnds =
        token.kind === "number" &&
        wordAfter &&
        (profile.id === "postgres" || (profile.id === "mysql" && /^(?!0x)[\d.]*[.eE]/i.test(token.text)));
      if (numberEnds) owner.fill(++piece, next.start);
    });
  }
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
 * always counts as the table. After a `.` (`billing.order by`), `order` is a table's name and
 * `by` its alias.
 */
function isOrderOrGroupBy(tokens: readonly Token[], i: number): boolean {
  const kw = tokens[i]!.kw;
  if (kw === "order" || kw === "group") return tokens[i + 1]?.kw === "by" && tokens[i - 1]?.text !== ".";
  return kw === "by" && (tokens[i - 1]?.kw === "order" || tokens[i - 1]?.kw === "group") && tokens[i - 2]?.text !== ".";
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
  /** The predicate's own `SELECT`, where the qualifier is its column's; else one it reaches through `col IN (…)`. */
  readonly ownSelect: boolean;
  /** The `ON` the predicate is ANDed into, if it is: unqualified, it names only that join's operands ({@link seenByOn}). */
  readonly on?: number;
};

/** A tenant predicate for one target, and the `SELECT`s it filters. */
type Occurrence = { readonly target: PredicateTarget; readonly filters: readonly Filter[] };

/** Words that start a query right after its `(`. */
const QUERY_START = QUERY_START_WORDS;
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

/**
 * A token's name for matching a table or CTE: lower-cased, and for a quoted name without its
 * trailing whitespace, which SQL Server ignores (`[orders ]` reads `orders`). Matching more
 * spellings finds more reads, so the check only gets stricter on engines that keep it.
 */
function tableNameOf(t: Token): string {
  return t.quoted === true ? t.lower.trimEnd() : t.lower;
}

/** Whether `token` may be a name: a quoted name, whatever it holds, or a word that starts with a letter or `_`. */
function isWord(token: Token | undefined): boolean {
  return token !== undefined && (token.quoted === true || /^[A-Za-z_\u0080-\uffff]/.test(token.text));
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

/**
 * The alias of the row source ending at `i`, in the only forms the check reads one: `orders o`,
 * `orders AS o`, `) t`, where the alias is followed by what ends the source ({@link endsSource})
 * or by its column list. Anything else (`orders TABLESAMPLE …`, `orders NOT INDEXED`) is no alias
 * the check recognises, so it returns undefined and the caller fails closed.
 */
function aliasAt(a: Analysis, i: number): number | undefined {
  const as = a.tokens[i + 1]?.kw === "as";
  if (!as && endsSource(a, i + 1)) return undefined;
  const alias = as ? i + 2 : i + 1;
  if (!isWord(a.tokens[alias])) return undefined;
  return endsSource(a, alias + 1) || a.tokens[alias + 1]?.text === "(" ? alias : undefined;
}

/**
 * The names the table reference at `i` goes by: its alias, or its own name when what follows ends
 * it with no alias. Anything else after it is a form the check doesn't read, so the read gets no
 * name and only an unqualified predicate filters it.
 */
function readNames(a: Analysis, i: number): Set<string> {
  const end = sourceEnd(a, i);
  if (hiddenByGroupAlias(a, end)) return new Set();
  const alias = aliasAt(a, end);
  if (alias !== undefined) return a.tokens[alias + 1]?.text === "(" ? new Set() : new Set([a.tokens[alias]!.name]);
  return endsSource(a, end + 1) ? new Set([a.tokens[i]!.name]) : new Set();
}

/**
 * Whether the row source ending at `end` sits inside parentheses, in a source position, that
 * something other than the source's end follows: an alias (`("order" x) AS y`,
 * `(orders x CROSS JOIN s) AS j`) hides the names inside, so a predicate on `x` names another
 * read. Any other word there is a form the check doesn't read, so it fails closed the same way.
 */
function hiddenByGroupAlias(a: Analysis, end: number): boolean {
  const { tokens } = a;
  for (let open = enclosing(tokens, end, "("); open >= 0; open = enclosing(tokens, open, "(")) {
    if (opensQuery(tokens, open) || !inSourcePosition(tokens, open)) return false;
    const close = enclosing(tokens, open + 1, ")");
    if (close < 0 || !endsSource(a, close + 1)) return true;
  }
  return false;
}

/**
 * Where the table reference at `i` ends: past the `)` of any parentheses that hold it alone
 * (`ONLY (orders) a`, SQLite's `(orders) a`), since its alias follows them.
 */
function sourceEnd(a: Analysis, i: number): number {
  let start = qualifiedStart(a.tokens, i);
  let end = i;
  // Only parentheses in a source position (after `FROM`, `JOIN`, `ONLY`, `,` or another `(`), not a call's.
  const opensSource = (open: number) => {
    const before = a.tokens[open - 1];
    return before !== undefined && ((before.kw === "from" && opensFromClause(a.tokens, open - 1)) || ["join", "only", "lateral", "straight_join"].includes(before.kw) || before.text === "," || before.text === "(");
  };
  while (a.tokens[start - 1]?.text === "(" && a.tokens[end + 1]?.text === ")" && opensSource(start - 1)) {
    start--;
    end++;
  }
  return end;
}

/**
 * Whether the `(` at `open` sits where a row source starts: right after `FROM`, a join word,
 * `LATERAL`, `APPLY`, a comma of a `FROM` list, or another `(` that does.
 */
function inSourcePosition(tokens: readonly Token[], open: number): boolean {
  const before = tokens[open - 1];
  if (before === undefined) return false;
  if (before.kw === "from") return opensFromClause(tokens, open - 1);
  if (["join", "straight_join", "lateral", "apply"].includes(before.kw)) return true;
  if (before.text === "(") return !opensQuery(tokens, open - 1) && inSourcePosition(tokens, open - 1);
  if (before.text !== ",") return false;
  for (let k = open - 2; k >= 0; k--) {
    const t = tokens[k]!;
    if (t.depth < before.depth) return false;
    if (t.depth > before.depth) continue;
    if (t.kw === "from") return opensFromClause(tokens, k);
    if (t.kw === "select" || t.kw === "where" || t.kw === "having" || (CLAUSE_END.has(t.kw) && !JOIN_WORDS.has(t.kw))) return false;
  }
  return false;
}

/**
 * Whether a table read can start at `start`: right after a `SELECT`'s own `FROM`, a join word,
 * `ONLY`, `LATERAL`, a comma of a `FROM` list, or a `(` in one of those places that opens no query.
 * A whole-row reference in an expression (`json_agg(orders)`, `(orders).id`) starts none.
 */
function startsSource(tokens: readonly Token[], start: number): boolean {
  const before = tokens[start - 1];
  if (before === undefined) return false;
  if (before.kw === "from") return opensFromClause(tokens, start - 1);
  if (["join", "straight_join", "only", "lateral"].includes(before.kw)) return true;
  if (before.text === "(") return !opensQuery(tokens, start - 1) && startsSource(tokens, start - 1);
  return before.text === "," && inSourcePosition(tokens, start);
}

/**
 * Whether the `FROM` at `k` opens its `SELECT`'s own `FROM` clause: not `IS [NOT] DISTINCT FROM`,
 * and not a `FROM` inside a call's parentheses (`EXTRACT(YEAR FROM d)`, `SUBSTRING(s FROM 2)`).
 */
function opensFromClause(tokens: readonly Token[], k: number): boolean {
  if (tokens[k]?.kw !== "from" || tokens[k - 1]?.kw === "distinct") return false;
  const open = enclosing(tokens, k, "(");
  return open < 0 || opensQuery(tokens, open);
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
  return { name: tableNameOf(tokens[k - 1]!), at: k - 1 };
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
    if (tableNameOf(t) !== name || isOrderOrGroupBy(a.tokens, i) || a.tokens[i + 1]?.text === ".") return;
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
      // A quoted name spelled like the placeholder is a name, which nothing binds.
      if (t.text !== target.placeholder || t.quoted === true) continue;
      const predicate = predicateAt(a.tokens, k, target.column, a.view.reading.profile.id === "postgres");
      if (!predicate) continue;
      const filters = filteredScopes(a, predicate.start, predicate.end, qualifierOf(a.tokens, predicate.column), predicate.column);
      if (filters.length > 0) found.push({ target, filters });
    }
  });
  return found;
}

/**
 * Whether every read of `table` is filtered, on every reading, by a predicate from `targets`
 * (#399): a column and placeholder compared as a conjunct of a filter clause in the read's own
 * `SELECT`, and tied to that read by its qualifier. Each branch of a `UNION` / `INTERSECT` /
 * `EXCEPT` is its own `SELECT`, and so is every CTE body, derived table and subquery. A read in a
 * derived table or CTE is also filtered from outside, when that source passes the column through
 * unrenamed and every reference to it is filtered on it. See {@link validateTenantGuardrails}.
 */
function hasTenantPredicate(views: CodeViews, table: string, targets: readonly PredicateTarget[]): boolean {
  const name = table.toLowerCase();
  return views.every((view) => {
    const a = analyze(view);
    // Read the Postgres way, a column list after a read's alias, or after a parenthesized source it
    // sits in, renames its columns, so the read can't be checked.
    if (view.reading.profile.id === "postgres" && renamesColumns(a.tokens, name)) return false;
    const reads = readsOf(a, name);
    // A reading that sees the table's name but no read of it (the name only inside a longer quoted
    // name, or only as a qualifier) can't tell what filters it, so it fails closed.
    if (reads.length === 0) return !mentionsAsName(view, name);
    const found = occurrences(a, targets);
    const tableReads = reads.filter((r) => startsSource(a.tokens, qualifiedStart(a.tokens, r.at)));
    return reads.every((read) => {
      const sameSelect = tableReads.filter((r) => r.scope === read.scope);
      return tableReads.includes(read) && sameSelect.length > 1
        ? selfJoinReadFiltered(a, found, targets, read, name, sameSelect)
        : readFiltered(a, found, targets, read, name);
    });
  });
}

/**
 * Words Postgres never takes as a bare table alias: its reserved keywords, and those it reserves
 * except as a function or type name. So in `orders WHERE (`, `orders ON (` or `orders USING (` the
 * word after the table is no alias, and the `(` no column list.
 */
const NOT_A_TABLE_ALIAS: ReadonlySet<string> = new Set([
  "all", "analyse", "analyze", "and", "any", "array", "as", "asc", "asymmetric", "authorization", "binary", "both",
  "case", "cast", "check", "collate", "collation", "column", "concurrently", "constraint", "create", "cross",
  "current_catalog", "current_date", "current_role", "current_schema", "current_time", "current_timestamp",
  "current_user", "default", "deferrable", "desc", "distinct", "do", "else", "end", "except", "false", "fetch", "for",
  "foreign", "freeze", "from", "full", "grant", "group", "having", "ilike", "in", "initially", "inner", "intersect",
  "into", "is", "isnull", "join", "lateral", "leading", "left", "like", "limit", "localtime", "localtimestamp",
  "natural", "not", "notnull", "null", "offset", "on", "only", "or", "order", "outer", "overlaps", "placing",
  "primary", "references", "returning", "right", "select", "session_user", "similar", "some", "symmetric",
  "system_user", "table", "tablesample", "then", "to", "trailing", "true", "union", "unique", "user", "using",
  "variadic", "verbose", "when", "where", "window", "with",
]);

/**
 * Whether a read of the table `name` has its columns renamed by a column list after an alias, at any
 * depth: right after the table (`orders t (a, b)`, `orders AS t (a, b)`, `orders * t (a, b)`), or
 * after a parenthesized `FROM` item the read sits in, a join or a derived table
 * (`(orders o JOIN s ON true) AS j (a, b, agency_id)`). Postgres and CockroachDB read the list as
 * new names for the first columns, so a predicate on `agency_id` filters whatever column the list
 * names that, and the real one is renamed out of the way: the read can't be checked.
 */
function renamesColumns(tokens: readonly Token[], name: string): boolean {
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i]!.lower !== name) continue;
    for (let open = enclosing(tokens, i, "("); open >= 0; open = enclosing(tokens, open, "(")) {
      if (subqueryUse(tokens, open) !== "table") continue;
      const close = enclosing(tokens, open + 1, ")");
      if (close >= 0 && aliasWithColumnList(tokens, close + 1)) return true;
    }
    if (tokens[i + 1]?.text === ".") continue;
    if (aliasWithColumnList(tokens, tokens[i + 1]?.text === "*" ? i + 2 : i + 1)) return true;
  }
  return false;
}

/** Whether `tokens[j]` starts an alias and a column list: `AS t (` or `t (`, where a bare `t` is no reserved word. */
function aliasWithColumnList(tokens: readonly Token[], j: number): boolean {
  const as = tokens[j]?.kw === "as";
  const alias = tokens[as ? j + 1 : j];
  if (alias === undefined || !isIdentifier(alias) || tokens[as ? j + 2 : j + 1]?.text !== "(") return false;
  return as || alias.kw === "" || !NOT_A_TABLE_ALIAS.has(alias.kw);
}

/**
 * A read of a table its `SELECT` reads more than once (a self-join): it counts as filtered only
 * when every read of the table there is canonical (`table alias` or `table AS alias`, outside
 * parentheses, with a plain unquoted alias no other read there shares, in any case) and a
 * predicate qualified with its own alias filters it. Anything less can't tell the reads apart, so
 * it fails closed.
 */
function selfJoinReadFiltered(
  a: Analysis,
  found: readonly Occurrence[],
  targets: readonly PredicateTarget[],
  read: Read,
  table: string,
  sameSelect: readonly Read[],
): boolean {
  const aliases = sameSelect.map((r) => canonicalAlias(a, r));
  if (aliases.some((alias) => alias === undefined)) return false;
  if (new Set(aliases.map((alias) => alias!.toLowerCase())).size !== aliases.length) return false;
  const mine = canonicalAlias(a, read)!;
  return found.some((o) =>
    o.filters.some((f) =>
      f.scope === read.scope && f.qualifier === mine && targets.includes(o.target) &&
      (!o.target.discriminator || hasDiscriminator(a, read, o.target))));
}

/** The plain alias of a read written `table alias` or `table AS alias`, at its `SELECT`'s own level; else undefined. */
function canonicalAlias(a: Analysis, read: Read): string | undefined {
  const { tokens } = a;
  const open = scopeOpen(read.scope);
  const depth = open < 0 ? 0 : tokens[open]!.depth + 1;
  if (tokens[read.at]!.depth !== depth || sourceEnd(a, read.at) !== read.at) return undefined;
  const at = aliasAt(a, read.at);
  if (at === undefined || tokens[at]!.quoted === true || tokens[at + 1]?.text === "(") return undefined;
  return tokens[at]!.name;
}

function readFiltered(a: Analysis, found: readonly Occurrence[], targets: readonly PredicateTarget[], read: Read, table: string): boolean {
  for (const o of found) {
    for (const f of o.filters) {
      if (f.scope !== read.scope || !filtersRead(a, f, o.target, read, table)) continue;
      if (o.target.discriminator && !hasDiscriminator(a, read, o.target)) continue;
      return true;
    }
  }
  return targets.some((target) => target.table.toLowerCase() === table && !target.discriminator && filteredFromOutside(a, found, read, target, 0));
}

/**
 * Whether a predicate that filters `read`'s `SELECT` through `filter` filters `read` itself.
 * Unqualified, it does: the read's table has the column, so the name resolves to it or the SQL is
 * ambiguous. On the read's own column, its qualifier must name that read ({@link readNames});
 * on another table's column (a root filtered through a column
 * that carries its IDs), a read of that table. A qualifier that names no read the check sees,
 * such as a table function's alias, counts for nothing. Through `col IN (…)`, which read of
 * another table `col` filters is left to the join.
 */
function filtersRead(a: Analysis, filter: Filter, target: PredicateTarget, read: Read, table: string): boolean {
  const q = filter.qualifier;
  if (q === undefined) return filter.on === undefined || seenByOn(a.tokens, filter.on, read.at);
  const owner = target.table.toLowerCase();
  if (owner === table) return read.names.has(q);
  return !filter.ownSelect || readsOf(a, owner).some((r) => r.names.has(q));
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
    filtered = refs !== undefined && refs.length > 0 && passesThrough(a, open, read.names, target.column) &&
      refs.every((ref) =>
        found.some((o) =>
          o.target === target &&
          o.filters.some((f) => f.ownSelect && f.scope === ref.scope && (f.qualifier === undefined ? f.on === undefined || seenByOn(a.tokens, f.on, ref.at) : ref.names.has(f.qualifier)))) ||
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
  // A derived table only in a source position: a subquery after `ON` or in an expression is no row source.
  if (!opensAfterAs(tokens, open) && !inSourcePosition(tokens, open)) return undefined;
  if (opensAfterAs(tokens, open)) {
    const cte = cteAt(tokens, open);
    if (cte === undefined) return undefined; // a column list renames the output, or it's no CTE this check reads
    const refs: Read[] = [];
    for (let j = 0; j < tokens.length; j++) {
      if (j === cte.at || tableNameOf(tokens[j]!) !== cte.name || tokens[j + 1]?.text === "." || isOrderOrGroupBy(tokens, j)) continue;
      if (j > open && j < close) return undefined; // recursive
      if (tokens[j + 1]?.text === "(" || hasColumnList(a, sourceEnd(a, j))) return undefined;
      refs.push({ at: j, scope: scopes.of[j]!, names: readNames(a, j) });
    }
    return refs;
  }
  if (hasColumnList(a, close)) return undefined;
  const alias = aliasAt(a, close);
  const hidden = hiddenByGroupAlias(a, alias ?? close);
  return [{ at: open, scope: scopes.of[open]!, names: new Set(alias === undefined || hidden ? [] : [tokens[alias]!.name]) }];
}

/** Clauses that compute over a source's rows, or pick some of them, before an outside filter runs. */
const COMPUTES_OVER_ROWS = new Set(["group", "having", "window", "qualify", "limit", "offset", "fetch", "top", "over"]);

/**
 * Whether the body of the query at `open` passes `column` of the read named `names` through to
 * its output unrenamed, and computes nothing across rows: every select-list item is a plain column
 * (`col` or `q.col`, optionally aliased), `q.*` or `*`; exactly one yields that name, and it is the
 * column itself, the read's `q.*`, or `*` over a single source; and the body has no `GROUP BY`,
 * `HAVING`, window, `QUALIFY`, `LIMIT`, `OFFSET`, `FETCH` or `TOP`, which would run over every tenant's rows
 * before the outside filter. An item with a string or comment in it, `DISTINCT ON` or a nested
 * `WITH` fails closed. The column and the name it yields are compared as {@link namesColumn} reads
 * them, and an item that yields the name in another case fails closed too.
 */
function passesThrough(a: Analysis, open: number, names: ReadonlySet<string>, column: string): boolean {
  const { tokens, scopes, view } = a;
  const exact = view.reading.profile.id === "postgres";
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
    let alias: Token | undefined;
    let expr = ts;
    if (n >= 3 && ts[n - 2]!.kw === "as" && isWord(ts[n - 1])) {
      alias = ts[n - 1]!;
      expr = ts.slice(0, n - 2);
    } else if (n >= 2 && isWord(ts[n - 1]) && (isWord(ts[n - 2]) || ts[n - 2]!.text === ")" || /^\d/.test(ts[n - 2]!.text))) {
      alias = ts[n - 1]!;
      expr = ts.slice(0, n - 1);
    }
    const isColumn = expr.length === 1 ? isWord(expr[0]) : expr.length === 3 && isWord(expr[0]) && expr[1]!.text === "." && isWord(expr[2]);
    if (!isColumn) return false; // an expression, a call or an aggregate
    const name = expr[expr.length - 1]!;
    // An item that yields the name in any case is a candidate; it must name the column the way the engine reads it.
    if ((alias ?? name).lower !== column.toLowerCase()) continue;
    if (!namesColumn(alias ?? name, column, exact) || !namesColumn(name, column, exact)) return false;
    if (expr.length === 3 && !names.has(expr[0]!.name)) return false; // another expression named like the column
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
 * Whether `read`'s `SELECT` ANDs in `col = '<value>'` for `target.discriminator`: its column, as
 * {@link namesColumn} compares it (unqualified, or qualified with the read's table or alias), `=`, and a plain `'…'` literal,
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
    if (a.scopes.of[i] !== read.scope || !isIdentifier(t) || !namesColumn(t, column, view.reading.profile.id === "postgres") || eq?.text !== "=") continue;
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
    const filters = filteredScopes(a, qualifiedStart(tokens, i), i + 1, qualifier, i);
    if (filters.some((f) => f.ownSelect && f.scope === read.scope && (qualifier !== undefined || f.on === undefined || seenByOn(tokens, f.on, read.at)))) return true;
  }
  return false;
}

/** An identifier token: a word that isn't one of the predicate forms' keywords. */
function isIdentifier(token: Token): boolean {
  return token.quoted === true || (/^[A-Za-z_\u0080-\uffff]/.test(token.text) && !PREDICATE_WORDS.has(token.kw));
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
 * qualified name) is `column`, as {@link namesColumn} compares them with `exact`. Which read the
 * column belongs to is its qualifier's to say.
 */
function predicateAt(tokens: readonly Token[], k: number, column: string, exact = false): { start: number; end: number; column: number } | undefined {
  const at = (i: number) => tokens[i];
  const matches = (i: number) => {
    const t = at(i);
    return t !== undefined && isIdentifier(t) && namesColumn(t, column, exact);
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

/**
 * Whether the written column `t` is the policy's `column`, the way the engine reads the name. With
 * `exact` (the Postgres readings: `postgres`, `cockroachdb`, a custom id or none), the engine
 * compares the name as it reads it, a quoted name exactly and an unquoted one folded to lower case,
 * with the column's own spelling, which the policy writes as the schema does. So `"AGENCY_ID"` is
 * another column than `agency_id`, and an unquoted `agencyid` another than `"agencyId"`: another
 * source in the query may hold it. Otherwise names match in any case, as MySQL, MariaDB, SQL Server
 * and SQLite compare column names.
 */
function namesColumn(t: Token, column: string, exact: boolean): boolean {
  return exact ? t.name === column : t.lower === column.toLowerCase();
}

/** How a parenthesized query (`(SELECT …)`) is used by the query around it. */
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

/** Words that make a join outer, wherever they stand in it: `LEFT HASH JOIN`, `LEFT STRAIGHT JOIN`, `FULL OUTER JOIN`. */
const OUTER_JOIN_WORDS = new Set(["left", "right", "full", "outer"]);
/** Words a join's own words start after, at its level: the source before it begins or ends at one of these. */
const BEFORE_A_JOIN = new Set(["from", "join", "on", "using", "apply"]);

/**
 * Whether the `ON` at `on` belongs to an outer join, whose `ON` doesn't filter the preserved side.
 * The join is outer when `LEFT`, `RIGHT`, `FULL` or `OUTER` stands anywhere among its words, between
 * the source before it and `JOIN`, as a keyword (not `LEFT(…)` or a qualified name), so a hint
 * between them (SQL Server's `HASH`, CockroachDB's `STRAIGHT`, `LOOKUP` or `INVERTED`) changes nothing.
 * An `ON` with another `ON` or `USING` between it and the nearest `JOIN` closes an earlier join
 * (`a LEFT JOIN b JOIN c ON … ON …`), which may be outer, so it counts as outer.
 */
function isOuterJoinOn(tokens: readonly Token[], on: number): boolean {
  const depth = tokens[on]!.depth;
  for (let i = on - 1; i >= 0; i--) {
    const t = tokens[i]!;
    if (t.depth < depth) return false;
    if (t.depth > depth) continue;
    if (t.kw === "on" || t.kw === "using") return true;
    if (t.kw !== "join") continue;
    for (let k = i - 1; k >= 0; k--) {
      const w = tokens[k]!;
      if (w.depth < depth) break;
      if (w.depth > depth) continue;
      if (BEFORE_A_JOIN.has(w.kw) || w.text === ",") break;
      const qualified = tokens[k - 1]?.text === "." || tokens[k + 1]?.text === ".";
      if (OUTER_JOIN_WORDS.has(w.kw) && !isFunctionCall(tokens, k) && !qualified) return true;
    }
    return false;
  }
  return false;
}

/** Join words that may take an `ON`: MySQL's `STRAIGHT_JOIN` may, so it counts as one. */
const TAKES_ON = new Set(["join", "straight_join"]);

/**
 * Whether the read at `at` is among the operands of the join the `ON` at `on` closes: the only reads
 * an unqualified column there can name. They run from the join's left operand up to the `ON`. Going
 * left from the join's own `JOIN`, the left operand stops at `FROM`, at the `(` around the join, at
 * a `FROM`-list comma (which binds looser than a join, though not on SQLite, where this only
 * narrows the check), or at a `JOIN` whose `ON` or `USING` hasn't come yet (`a LEFT JOIN b JOIN c
 * ON … ON …`). `CROSS JOIN`, `NATURAL JOIN` and `APPLY` take no `ON`, so the operand runs past them.
 */
function seenByOn(tokens: readonly Token[], on: number, at: number): boolean {
  if (at >= on) return false;
  const depth = tokens[on]!.depth;
  let join = -1;
  for (let i = on - 1; i >= 0 && join < 0; i--) {
    const t = tokens[i]!;
    if (t.depth < depth) return false;
    if (t.depth > depth) continue;
    if (t.kw === "from" || t.text === ",") return false;
    if (TAKES_ON.has(t.kw)) join = i;
  }
  if (join < 0) return false;
  let pending = 0; // ON or USING seen going left, each closing a JOIN further left
  for (let i = join - 1; i >= 0; i--) {
    const t = tokens[i]!;
    if (t.depth < depth) return at > i;
    if (t.depth > depth) continue;
    if (t.kw === "from" || t.text === ",") return at > i;
    if (t.kw === "on" || t.kw === "using") pending++;
    else if (TAKES_ON.has(t.kw) && !takesNoOn(tokens, i)) {
      if (pending === 0) return at > i;
      pending--;
    }
  }
  return true;
}

/** Whether the `JOIN` at `join` is a `CROSS JOIN` or a `NATURAL … JOIN`, which take no `ON`. */
function takesNoOn(tokens: readonly Token[], join: number): boolean {
  const depth = tokens[join]!.depth;
  for (let k = join - 1; k >= 0; k--) {
    const w = tokens[k]!;
    if (w.depth !== depth || BEFORE_A_JOIN.has(w.kw) || w.text === ",") return false;
    if ((w.kw === "cross" || w.kw === "natural") && tokens[k - 1]?.text !== "." && tokens[k + 1]?.text !== ".") return true;
  }
  return false;
}

/**
 * The `SELECT`s whose reads the term `tokens[start..end]` filters (#399), each with the qualifier
 * that ties it to a read there. The term must be ANDed into a `WHERE`, `ON` (of an inner join) or
 * `HAVING` clause: at its own level and at every enclosing parenthesized level up to that clause,
 * it sits between `AND`s (or the clause's start and end), with no `OR`, `XOR` (or MySQL's `||`)
 * at that level and no `NOT` in front of it. It then filters that clause's `SELECT`, through
 * `qualifier`, its column's. When that `SELECT` is the whole right side of `col IN (…)` and the
 * `col IN (…)` is itself such a conjunct, it filters the query around it too, through `col`'s
 * qualifier. A level opened by a function call or a comparison doesn't count.
 */
function filteredScopes(a: Analysis, start: number, end: number, qualifier: string | undefined, termColumn: number): Filter[] {
  const { tokens, scopes } = a;
  const disjunction = (t: Token) => t.kw === "or" || t.kw === "xor" || (t.text === "||" && a.view.reading.pipesAreOr);
  const endsClause = (i: number) => CLAUSE_END.has(tokens[i]!.kw) && !isFunctionCall(tokens, i);
  const filters: Filter[] = [];
  let lo = start;
  let hi = end;
  let depth = tokens[start]!.depth;
  let q = qualifier;
  let ownSelect = true;
  let column = termColumn;
  for (;;) {
    // What is directly around the term, at its level.
    const before = tokens[lo - 1];
    const after = tokens[hi + 1];
    const leftOk = before !== undefined && (conjunctAnd(tokens, lo - 1) || before.text === "(" || FILTER_CLAUSE.has(before.kw));
    const rightOk = after === undefined || after.kw === "and" || after.text === ")" || after.text === ";" || endsClause(hi + 1);
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
      if (t.text === ";" || endsFilterScan(tokens, j, a.view.reading.profile.id)) break;
      if (disjunction(t)) return filters;
    }

    if (clause >= 0) {
      if (tokens[clause]!.kw === "on" && isOuterJoinOn(tokens, clause)) return filters;
      if (tokens[clause]!.kw === "having" && !onGroupKey(a, clause, column)) return filters;
      const scope = scopes.of[clause]!;
      filters.push({ scope, qualifier: q, ownSelect, ...(tokens[clause]!.kw === "on" ? { on: clause } : {}) });
      // `col IN (<this SELECT>)` limits the query around it to the rows this SELECT returns.
      const query = scopeOpen(scope);
      const queryClose = scopes.close.get(query);
      if (query < 0 || queryClose === undefined || scopes.branched.has(query) || subqueryUse(tokens, query) !== "in") return filters;
      lo = qualifiedStart(tokens, query - 2);
      hi = queryClose;
      depth = tokens[query]!.depth;
      q = qualifierOf(tokens, query - 2);
      column = query - 2;
      ownSelect = false;
      continue;
    }

    if (open < 0 || tokens[open]!.text !== "(" || close >= tokens.length || tokens[close]!.text !== ")") return filters;
    // A parenthesized group counts only as a plain boolean conjunct: opened right after
    // WHERE/ON/HAVING, AND, or another "(". Anything else (`f(`, `IN (`, `EXISTS (`,
    // `NOT (`, `= (`) makes it something other than a filter conjunct.
    const opener = tokens[open - 1];
    if (opener === undefined || !(FILTER_CLAUSE.has(opener.kw) || conjunctAnd(tokens, open - 1) || opener.text === "(")) return filters;
    lo = open;
    hi = close;
    depth = tokens[open]!.depth;
  }
}

/** Whether the token at `i` is an `AND` that joins two conjuncts, not the `AND` of a `BETWEEN`. */
function conjunctAnd(tokens: readonly Token[], i: number): boolean {
  return tokens[i]?.kw === "and" && !andOfBetween(tokens, i);
}

/**
 * Whether the `AND` at `and` closes a `BETWEEN` (`x BETWEEN 0 AND y`), so that what follows is the
 * upper bound, not a conjunct: MySQL reads `0 BETWEEN 0 AND col IN (…)` with the `IN` inside the
 * bound. Each `BETWEEN` at the `AND`'s level, from the start of its clause or parentheses, takes the
 * first `AND` after it there, whatever its lower bound holds (`LEFT(…)`, a cast); an `AND` inside a
 * `CASE … END` belongs to the `CASE`.
 */
function andOfBetween(tokens: readonly Token[], and: number): boolean {
  const depth = tokens[and]!.depth;
  // A word beside a `.` is a name (`o.and`, `o.end`), never the keyword.
  const dotted = (i: number) => tokens[i - 1]?.text === "." || tokens[i + 1]?.text === ".";
  let from = and - 1;
  while (from >= 0) {
    const t = tokens[from]!;
    if (t.depth < depth || (t.depth === depth && !dotted(from) && (FILTER_CLAUSE.has(t.kw) || t.kw === "select"))) break;
    from--;
  }
  let pending = 0;
  let inCase = 0;
  for (let i = from + 1; i < and; i++) {
    const t = tokens[i]!;
    if (t.depth !== depth || dotted(i)) continue;
    if (t.kw === "case") inCase++;
    else if (t.kw === "end" && inCase > 0) inCase--;
    else if (inCase === 0 && t.kw === "between") pending++;
    else if (inCase === 0 && t.kw === "and" && pending > 0) pending--;
  }
  return pending > 0;
}

/**
 * Whether the word at `j` ends the scan for an `OR` beside a predicate: a clause start that every
 * engine reserves (`WHERE`, `HAVING`, `GROUP BY`, `ORDER BY`, a set operation, `JOIN`), not beside a
 * `.`, and MySQL's `STRAIGHT_JOIN` where the SQL is read as MySQL. Other clause words (`LIMIT`, `LOCK`,
 * `QUALIFY`, `NATURAL`, `USING`, `WINDOW`) are names on some engine, so the scan goes on past them, and
 * an `OR` after one still counts as beside the predicate.
 */
function endsFilterScan(tokens: readonly Token[], j: number, engine: string): boolean {
  const t = tokens[j]!;
  if (tokens[j - 1]?.text === "." || tokens[j + 1]?.text === "." || isFunctionCall(tokens, j)) return false;
  if (t.kw === "group" || t.kw === "order") return tokens[j + 1]?.kw === "by";
  if (t.kw === "straight_join") return engine === "mysql";
  return ["where", "having", "union", "intersect", "except", "join"].includes(t.kw);
}

/**
 * Whether a predicate on the column at `column`, ANDed into the `HAVING` at `having`, filters rows:
 * only when that column is a plain key of its `SELECT`'s `GROUP BY` (`agency_id`, or `o.agency_id`
 * written the same way). On any other column, a group holds every row it covers, and SQLite and
 * MariaDB take the column's value from one of them. Read the MySQL way, an unqualified column that a
 * select-list item is aliased to never counts: MySQL and MariaDB resolve such a `HAVING` name to the
 * alias in some forms and to the `GROUP BY` column in others, so the check refuses the name either way.
 */
function onGroupKey(a: Analysis, having: number, column: number): boolean {
  const { tokens } = a;
  const depth = tokens[having]!.depth;
  let select = -1;
  let groupBy = -1;
  for (let i = having - 1; i >= 0 && select < 0; i--) {
    const t = tokens[i]!;
    if (t.depth < depth) break;
    if (t.depth > depth) continue;
    if (t.kw === "by" && tokens[i - 1]?.kw === "group" && groupBy < 0) groupBy = i;
    if (t.kw === "select") select = i;
  }
  if (select < 0 || groupBy < 0) return false;
  const name = tokens[column]!.lower;
  const qualifier = qualifierOf(tokens, column);
  const itemRanges = (from: number, to: number): Array<[number, number]> => {
    const out: Array<[number, number]> = [];
    let itemStart = from;
    for (let i = from; i <= to; i++) {
      const t = tokens[i];
      if (i === to || (t?.depth === depth && t.text === ",")) {
        if (i > itemStart) out.push([itemStart, i - 1]);
        itemStart = i + 1;
      }
    }
    return out;
  };
  if (a.view.reading.profile.id === "mysql" && qualifier === undefined) {
    let from = select + 1;
    while (tokens[from]?.kw === "distinct" || tokens[from]?.kw === "all") from++;
    let fromKw = from;
    while (fromKw < having && !(tokens[fromKw]!.depth === depth && tokens[fromKw]!.kw === "from")) fromKw++;
    const aliased = itemRanges(from, fromKw).some(([s, e]) => e > s && tokens[e - 1]?.text !== "." && isIdentifier(tokens[e]!) && tokens[e]!.lower === name);
    if (aliased) return false;
  }
  return itemRanges(groupBy + 1, having).some(([s, e]) => {
    const last = tokens[e]!;
    if (!isIdentifier(last) || last.lower !== name) return false;
    const plain = e === s || (e === s + 2 && tokens[s + 1]?.text === ".");
    return plain && qualifierOf(tokens, e) === qualifier;
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
