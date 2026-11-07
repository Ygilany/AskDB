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
  readSql,
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
 * the same query block, with a `mapping` key of the root whose placeholder filters
 * its id column. It does not tie a predicate
 * to one table reference, so an unfiltered reference beside a filtered one can
 * still pass; database-side row-level security is the sound boundary.
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
  // rows: `owner_type = 'agency' AND owner_id = :tenant_agency_ids`, ANDed in the same block.
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
  /** Lower-cased, for identifier comparison. */
  readonly lower: string;
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
  const split = lexerWordEnds(view);
  let depth = 0;
  let quoted = false;
  for (const m of view.text.matchAll(TOKEN)) {
    if (m[0] === QUOTE_MARK) {
      quoted = !quoted;
      continue;
    }
    for (const [t, offset] of WORD_OR_NUMBER.test(m[0]) ? split(m[0], m.index) : [[m[0], m.index] as const]) {
      if (t === ")") depth = Math.max(0, depth - 1);
      const lower = t.toLowerCase();
      tokens.push({ text: t, lower, kw: quoted ? "" : lower, depth, offset });
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

/** Keywords that combine query blocks; each block is checked on its own. */
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
 * `discriminator`, the same query block must also AND in `discriminator.column = '<v>'`
 * for one of its `values` (a polymorphic table's type column and mapping keys).
 */
type PredicateTarget = {
  readonly placeholder: string;
  readonly column: string;
  readonly table: string;
  readonly discriminator?: { readonly column: string; readonly values: readonly string[] };
};

/**
 * Whether the statement has a tenant predicate for `table` on every reading: a column
 * and placeholder from `targets`, compared as a conjunct of a filter clause. Every query
 * block that mentions the table needs its own: the statement, and each branch of every
 * `UNION` / `INTERSECT` / `EXCEPT`, at the top level or inside a derived table or CTE.
 * See {@link validateTenantGuardrails} for the rule.
 */
function hasTenantPredicate(views: CodeViews, table: string, targets: readonly PredicateTarget[]): boolean {
  const name = table.toLowerCase();
  return views.every((view) => {
    const tokens = tokenize(view);
    // Read the Postgres way, a column list after the table's alias renames its columns, and a quoted
    // name is compared exactly.
    const postgres = view.reading.profile.id === "postgres";
    if (postgres && renamesColumns(tokens, name)) return false;
    // Every spelling of the name counts as the table, quoted or not, except the words of `ORDER BY`.
    const mentions = (from: number, to: number) => {
      for (let i = from; i < to; i++) if (tokens[i]!.lower === name && !isOrderOrGroupBy(tokens, i)) return true;
      return false;
    };
    return queryBlocks(tokens)
      .filter(([from, to]) => mentions(from, to))
      .every(([from, to]) => {
        for (let k = from; k < to; k++) {
          for (const target of targets) {
            if (tokens[k]!.text !== target.placeholder) continue;
            const span = predicateSpan(tokens, k, target, postgres);
            if (!span || !isFilterConjunct(tokens, span[0], span[1], view.reading)) continue;
            if (!target.discriminator || hasDiscriminator(tokens, from, to, view, target)) return true;
          }
        }
        return false;
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
 * Whether a read of the table `name` is followed by an alias and a column list (`orders t (a, b)`,
 * `orders AS t (a, b)`, `orders * t (a, b)`), at any depth. Postgres and CockroachDB read the list as
 * new names for the table's first columns, so a predicate on `t.agency_id` filters whatever column
 * comes first, and the real one is renamed out of the way: the read can't be checked.
 */
function renamesColumns(tokens: readonly Token[], name: string): boolean {
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i]!.lower !== name || tokens[i + 1]?.text === ".") continue;
    let j = i + 1;
    if (tokens[j]?.text === "*") j++;
    const as = tokens[j]?.kw === "as";
    if (as) j++;
    const alias = tokens[j];
    if (alias === undefined || !isIdentifier(alias) || tokens[j + 1]?.text !== "(") continue;
    if (as || alias.kw === "" || !NOT_A_TABLE_ALIAS.has(alias.kw)) return true;
  }
  return false;
}

/**
 * Whether the block `tokens[from, to)` ANDs in `col = '<value>'` for `target.discriminator`:
 * its column (optionally qualified with the target's table or alias), `=`, and a plain
 * `'…'` literal, read from `view.source` at the offsets where the view blanked it, whose
 * value is one of the discriminator's values and which nothing but whitespace follows up
 * to the next token (no `''`-escape, no adjacent literal, no comment).
 */
function hasDiscriminator(tokens: readonly Token[], from: number, to: number, view: CodeViews[number], target: PredicateTarget): boolean {
  const { column, values } = target.discriminator!;
  const source = view.source;
  for (let i = from; i < to; i++) {
    const t = tokens[i]!;
    const eq = tokens[i + 1];
    if (!isIdentifier(t) || t.lower !== column.toLowerCase() || eq?.text !== "=") continue;
    const qualifier = tokens[i - 1]?.text === "." ? tokens[i - 2] : undefined;
    if (qualifier !== undefined && namesOtherTable(tokens, qualifier.lower, target.table.toLowerCase())) continue;
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
    if (isFilterConjunct(tokens, qualifiedStart(tokens, i), i + 1, view.reading)) return true;
  }
  return false;
}

/**
 * Token ranges `[from, to)` of the statement's query blocks: the whole statement, and
 * each branch of every set operation at any depth (bounded by the parentheses around it).
 */
function queryBlocks(tokens: readonly Token[]): Array<[number, number]> {
  const blocks: Array<[number, number]> = [[0, tokens.length]];
  const splits = new Map<number, number[]>(); // enclosing "(" (or -1) → set-operator positions
  tokens.forEach((t, i) => {
    if (!SET_OPERATORS.has(t.kw)) return;
    const open = enclosing(tokens, i, "(");
    splits.set(open, [...(splits.get(open) ?? []), i]);
  });
  for (const [open, positions] of splits) {
    const end = open < 0 ? tokens.length : enclosing(tokens, open + 1, ")");
    let from = open + 1;
    for (const at of positions) {
      blocks.push([from, at]);
      from = at + 1;
    }
    blocks.push([from, end < 0 ? tokens.length : end]);
  }
  return blocks;
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
 * The token span `[start, end]` of a tenant predicate around the placeholder at `k`:
 * `col = P`, `P = col`, `col IN (P)` or `col = ANY (P)`, where `col` (the last part of a
 * possibly qualified name) is the target's column. A qualifier that names, or is the
 * alias of, a table other than the target's makes it no predicate for that table. With
 * `exactQuoted` (read the Postgres way, where a quoted name is compared exactly), a quoted
 * `col` counts only when spelled as the schema spells the column: `"AGENCY_ID"` is another
 * column there, which another source in the query may hold.
 */
function predicateSpan(tokens: readonly Token[], k: number, target: PredicateTarget, exactQuoted: boolean): [number, number] | undefined {
  const at = (i: number) => tokens[i];
  const column = target.column.toLowerCase();
  const matches = (i: number) => {
    const t = at(i);
    if (t === undefined || !isIdentifier(t) || t.lower !== column) return false;
    if (exactQuoted && t.kw === "" && t.text !== target.column) return false;
    const qualifier = at(i - 1)?.text === "." ? at(i - 2) : undefined;
    return qualifier === undefined || !namesOtherTable(tokens, qualifier.lower, target.table.toLowerCase());
  };
  // col = P
  if (at(k - 1)?.text === "=" && matches(k - 2)) return [qualifiedStart(tokens, k - 2), k];
  const closed = at(k + 1)?.text === ")";
  // col IN ( P )
  if (closed && at(k - 1)?.text === "(" && at(k - 2)?.kw === "in" && matches(k - 3)) {
    return [qualifiedStart(tokens, k - 3), k + 1];
  }
  // col = ANY ( P )
  if (closed && at(k - 1)?.text === "(" && at(k - 2)?.kw === "any" && at(k - 3)?.text === "=" && matches(k - 4)) {
    return [qualifiedStart(tokens, k - 4), k + 1];
  }
  // P = col
  if (at(k + 1)?.text === "=") {
    let end = k + 2;
    while (at(end + 1)?.text === "." && at(end + 2) !== undefined && isIdentifier(at(end + 2)!)) end += 2;
    if (matches(end)) return [k, end];
  }
  return undefined;
}

/**
 * Whether the qualifier `name` names a table other than `table`: `name` is that other
 * table, or is declared as its alias (`FROM appointments a`, `JOIN appointments AS a`).
 * A qualifier the statement doesn't declare (a derived table's or CTE's name) names no
 * known table, so it doesn't rule the predicate out.
 */
function namesOtherTable(tokens: readonly Token[], name: string, table: string): boolean {
  if (name === table) return false;
  for (let i = 1; i < tokens.length; i++) {
    if (tokens[i]!.lower !== name || !isIdentifier(tokens[i]!)) continue;
    const source = tokens[i - 1]?.kw === "as" ? i - 2 : i - 1;
    const src = tokens[source];
    if (src === undefined || !isIdentifier(src) || tokens[source + 1]?.text === ".") continue;
    const before = tokens[qualifiedStart(tokens, source) - 1];
    if (before !== undefined && (before.kw === "from" || before.kw === "join" || before.text === ",")) {
      return src.lower !== table;
    }
  }
  return false;
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

/**
 * Whether the term `tokens[start..end]` is ANDed into a `WHERE`, `ON` (of an inner join)
 * or `HAVING` clause of the statement: at its own level and at every enclosing
 * parenthesized level up to that clause, it sits between `AND`s (or the clause's start
 * and end), with no `OR`, `XOR` (or MySQL's `||`) at that level and no `NOT` in front of
 * it. A clause inside a subquery counts only when the subquery is a row source (a
 * derived table or CTE), or when the whole `col IN (…)` around it is itself such a
 * conjunct; not inside `EXISTS (…)`, a scalar subquery, or a comparison. A level opened by a function call or a comparison doesn't count.
 */
function isFilterConjunct(tokens: readonly Token[], start: number, end: number, reading: CodeViewReading): boolean {
  const disjunction = (t: Token) => t.kw === "or" || t.kw === "xor" || (t.text === "||" && reading.pipesAreOr);
  const endsClause = (i: number) => CLAUSE_END.has(tokens[i]!.kw) && !isFunctionCall(tokens, i);
  let lo = start;
  let hi = end;
  let depth = tokens[start]!.depth;
  for (;;) {
    // What is directly around the term, at its level.
    const before = tokens[lo - 1];
    const after = tokens[hi + 1];
    const leftOk = before !== undefined && (before.kw === "and" || before.text === "(" || FILTER_CLAUSE.has(before.kw));
    const rightOk = after === undefined || after.kw === "and" || after.text === ")" || after.text === ";" || endsClause(hi + 1);
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
      if (disjunction(t) || t.kw === "not") return false;
      if (FILTER_CLAUSE.has(t.kw)) {
        clause = i;
        break;
      }
      if ((endsClause(i) || NOT_A_FILTER.has(t.kw)) && !isFunctionCall(tokens, i)) return false;
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
      if (tokens[clause]!.kw === "on" && isOuterJoinOn(tokens, clause)) return false;
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
    if (opener === undefined || !(FILTER_CLAUSE.has(opener.kw) || opener.kw === "and" || opener.text === "(")) return false;
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
