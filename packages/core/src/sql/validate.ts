import { SqlValidationError, type SqlValidationRuleCode } from "../errors.js";
import { BUILT_IN_DIALECTS, type DialectSpec } from "./dialect-spec.js";
import {
  ENGINE_LEXER_PROFILES,
  GENERIC_LEXER,
  lexSql,
  lexerProfileFor,
  type SqlLexerProfile,
  type SqlToken,
} from "./lexer.js";
import { findAmbiguousTsqlText, findTsqlStatementBoundary } from "./tsql-batch.js";

/**
 * Keywords rejected in every dialect. Matched against unquoted word tokens only, so
 * `deleted_at`, `"delete"`, and `'delete me'` are unaffected.
 *
 * `into` covers `SELECT … INTO new_table` (creates a table), MySQL `INTO OUTFILE` /
 * `INTO DUMPFILE` / `INTO @var`, and T-SQL `SELECT … INTO`. No read-only SELECT needs it.
 * `merge` covers data-modifying `MERGE` inside a CTE (Postgres 17+) and T-SQL `MERGE`.
 */
const BASE_FORBIDDEN: readonly string[] = [
  "insert",
  "update",
  "delete",
  "drop",
  "truncate",
  "alter",
  "create",
  "grant",
  "revoke",
  "vacuum",
  "analyze",
  "copy",
  "call",
  "merge",
  "into",
];

function validationError(rule: SqlValidationRuleCode, summary: string, hint: string): SqlValidationError {
  return new SqlValidationError(summary, rule, hint);
}

/**
 * Read-only SELECT check for model-generated SQL. It is **defense in depth**, not a
 * security boundary: it lexes SQL the way the target engine does and rejects shapes
 * that are clearly not a single read-only query, but it is not a SQL parser and cannot
 * prove a statement is harmless. Run generated SQL under a database role that can only
 * read what the caller may see.
 *
 * Checks, in order (the first failure throws {@link SqlValidationError}):
 *
 * 1. `SQL_EMPTY` — nothing left after trimming.
 * 2. `SQL_UNTERMINATED` — a string, quoted identifier, dollar-quoted string, or block
 *    comment never closes. Fails closed rather than guessing where it ends.
 * 3. `SQL_MULTI_STATEMENT` — any `;` other than a single trailing one.
 * 4. `SQL_COMMENT` — any comment (`--`, `/* *\/`, and MySQL `#`).
 * 5. `SQL_NOT_SELECT_OR_WITH` — the first token (after any `(`) is not `SELECT`/`WITH`.
 * 6. `SQL_MULTI_STATEMENT`, SQL Server lexer only (so also for a dialect id that is no
 *    built-in engine) — a second statement written without `;`, which T-SQL doesn't
 *    need, or code SQL Server may split differently from the lexer (see `tsql-batch.ts`).
 * 7. `SQL_LOCKING_READ` — a locking read, at any depth: `FOR UPDATE`, `FOR NO KEY UPDATE`,
 *    `FOR SHARE`, `FOR KEY SHARE` or `LOCK IN SHARE MODE` on every lexer, and on the SQL Server
 *    lexer a lock hint such as `UPDLOCK` or `HOLDLOCK` anywhere (#319).
 * 8. `SQL_FORBIDDEN_KEYWORD` — an unquoted keyword from the shared denylist or the
 *    dialect's `extraForbiddenKeywords`.
 * 9. `SQL_FORBIDDEN_FUNCTION` — a call (`name(`) to a function in the dialect's
 *    `blockedFunctions` (side-effecting or file/network/sleep functions).
 *
 * Then the dialect's `extraValidate` runs on the statement without its trailing `;`.
 *
 * Returns the SQL trimmed and otherwise as written: a single trailing `;` (and any
 * whitespace before it) is kept. A host that wraps the statement, for example in a
 * row-cap subquery, removes the terminator first.
 *
 * The lexer follows `dialect.id`. When the id is not a built-in engine family, the SQL
 * must pass under every built-in lexer with every built-in denylist.
 */
export function validateSelectSql(dialect: DialectSpec, sql: string): string {
  const trimmed = sql.trim();
  if (!trimmed) {
    throw validationError(
      "SQL_EMPTY",
      "Generated SQL is empty after extraction.",
      "The model reply had no usable ```sql fenced block or the block was blank. Retry with a clearer question or inspect the raw model output with logging.",
    );
  }

  const profile = lexerProfileFor(dialect);
  let tokens: SqlToken[];
  const keywords = denylistFor(dialect);
  if (profile) {
    tokens = checkWithProfile(trimmed, profile, keywords, blockedFunctionsFor(dialect));
  } else {
    // Unknown engine: every plausible reading of the SQL must be safe.
    const functions = new Set([...blockedFunctionsFor(dialect), ...allBuiltInFunctions()]);
    tokens = [];
    for (const p of ENGINE_LEXER_PROFILES) tokens = checkWithProfile(trimmed, p, keywords, functions);
  }

  const last = tokens[tokens.length - 1];
  dialect.extraValidate?.(isPunct(last, ";") ? trimmed.slice(0, last!.start).trim() : trimmed);
  return trimmed;
}

function checkWithProfile(
  sql: string,
  profile: SqlLexerProfile,
  keywords: ReadonlySet<string>,
  functions: ReadonlySet<string>,
): SqlToken[] {
  const tokens = lexSql(sql, profile);

  const open = tokens.find((t) => t.unterminated);
  if (open) {
    throw validationError(
      "SQL_UNTERMINATED",
      `Generated SQL has an unterminated ${describeToken(open)}.`,
      "A quote, dollar-quote, or block comment never closes, so where the statement ends is ambiguous. Regenerate the query; the validator fails closed rather than guessing.",
    );
  }

  tokens.forEach((t, idx) => {
    if (isPunct(t, ";") && idx !== tokens.length - 1) {
      throw validationError(
        "SQL_MULTI_STATEMENT",
        "Multiple SQL statements are not allowed (semicolon separates more than one statement).",
        "Ask for a single SELECT (WITH … SELECT allowed). Split analytical steps into separate questions or use a CTE instead of multiple statements.",
      );
    }
  });

  const commentLike = tokens.some(
    (t, idx) =>
      t.kind === "comment" ||
      // `--` / `/*` that this dialect lexes as operators (MySQL `1--1`) are still rejected,
      // matching the historical "no comment markers" policy.
      (t.kind === "punct" &&
        ((t.text === "-" && isAdjacentPunct(t, tokens[idx + 1], "-")) ||
          (t.text === "/" && isAdjacentPunct(t, tokens[idx + 1], "*")))),
  );
  if (commentLike) {
    throw validationError(
      "SQL_COMMENT",
      "SQL comments (-- or /* … */, and # in MySQL) are not allowed under current guardrails.",
      "Remove comments from generated SQL; rely on clear column aliases and CTE names instead.",
    );
  }

  const head = headToken(tokens);
  if (head?.kind !== "word" || (head.lower !== "select" && head.lower !== "with")) {
    const got = head ? head.value.toLowerCase() : "";
    throw validationError(
      "SQL_NOT_SELECT_OR_WITH",
      `SQL must start with SELECT or WITH (got '${got || "none"}').`,
      "Regenerate as a read-only SELECT (optionally with WITH). INSERT/UPDATE/DELETE and procedural calls are blocked in dev guardrails.",
    );
  }

  if (profile.id === "sqlserver") {
    const ambiguous = findAmbiguousTsqlText(sql, tokens);
    if (ambiguous) {
      throw validationError(
        "SQL_MULTI_STATEMENT",
        `Multiple SQL statements are not allowed: SQL Server may split code at ${ambiguous}, so the check can't tell where one statement ends.`,
        "Separate keywords, names and numbers with ASCII spaces, and keep other characters inside string literals or [bracketed] names.",
      );
    }
    const statement = isPunct(tokens[tokens.length - 1], ";") ? tokens.slice(0, -1) : tokens;
    const boundary = findTsqlStatementBoundary(statement);
    if (boundary) {
      const what =
        boundary.kind === "select"
          ? "a second SELECT"
          : boundary.kind === "query"
            ? "a parenthesized query after a complete value"
            : `the label '${boundary.token.text}:'`;
      throw validationError(
        "SQL_MULTI_STATEMENT",
        `Multiple SQL statements are not allowed: T-SQL needs no semicolon between statements, so ${what} starts a second statement.`,
        "Ask for a single SELECT (WITH … SELECT allowed). Combine results with UNION, a CTE, or a subquery after an operator, a comma, or a keyword such as IN, EXISTS, FROM or APPLY.",
      );
    }
  }

  const locking = findLockingRead(tokens, profile);
  if (locking) {
    throw validationError(
      "SQL_LOCKING_READ",
      `Locking reads are not allowed: generated SQL uses ${locking}.`,
      "A locking read can hold locks that other sessions wait on until the host's transaction ends. Regenerate as a plain SELECT, without FOR UPDATE, FOR SHARE, LOCK IN SHARE MODE or a SQL Server lock hint such as UPDLOCK or HOLDLOCK.",
    );
  }

  for (const t of tokens) {
    if (t.kind === "word" && keywords.has(t.lower)) {
      throw validationError(
        "SQL_FORBIDDEN_KEYWORD",
        `Forbidden keyword in generated SQL: ${t.lower.toUpperCase()}.`,
        `Matched whole-word guardrail keyword "${t.lower}". This build allows read-only SELECT shape only; DDL/DML, SELECT … INTO, and similar verbs are rejected.`,
      );
    }
  }

  tokens.forEach((t, idx) => {
    const nameLike =
      t.kind === "word" || t.kind === "quoted_identifier" || (t.kind === "string" && t.quote === '"');
    if (!nameLike) return;
    const name = t.kind === "string" ? t.text.slice(1, -1).toLowerCase() : t.lower;
    if (functions.has(name) && isPunct(tokens[idx + 1], "(")) {
      throw validationError(
        "SQL_FORBIDDEN_FUNCTION",
        `Forbidden function in generated SQL: ${name}().`,
        `"${name}" has side effects (writes, file or network access, sleeping, session changes) and is blocked for this dialect. Remove the call.`,
      );
    }
  });

  return tokens;
}

/**
 * The words `validateSelectSql` rejects unquoted for a dialect, lowercase: the shared denylist
 * and the spec's `extraForbiddenKeywords`, plus every built-in spec's for an id that is no
 * built-in engine family, and T-SQL's lock hints wherever the SQL Server lexer runs. The
 * NL→SQL prompt quotes names in this set.
 */
export function keywordsRejectedUnquoted(
  dialect: Pick<DialectSpec, "id" | "backslashEscapes" | "extraForbiddenKeywords">,
): Set<string> {
  const words = denylistFor(dialect);
  const profile = lexerProfileFor(dialect);
  if (!profile || profile.id === "sqlserver") for (const hint of TSQL_LOCK_HINTS) words.add(hint);
  return words;
}

/**
 * The `SQL_FORBIDDEN_KEYWORD` denylist: the shared list and the spec's `extraForbiddenKeywords`,
 * plus every built-in spec's for an id that is no built-in engine family.
 */
function denylistFor(dialect: Pick<DialectSpec, "id" | "backslashEscapes" | "extraForbiddenKeywords">): Set<string> {
  const keywords = new Set([...BASE_FORBIDDEN, ...(dialect.extraForbiddenKeywords ?? [])].map((w) => w.toLowerCase()));
  if (!lexerProfileFor(dialect)) for (const word of allBuiltInKeywords()) keywords.add(word.toLowerCase());
  return keywords;
}

function blockedFunctionsFor(dialect: DialectSpec): Set<string> {
  return new Set((dialect.blockedFunctions ?? []).map((w) => w.toLowerCase()));
}

function allBuiltInKeywords(): string[] {
  return Object.values(BUILT_IN_DIALECTS).flatMap((d) => [...(d.extraForbiddenKeywords ?? [])]);
}

function allBuiltInFunctions(): string[] {
  return Object.values(BUILT_IN_DIALECTS).flatMap((d) => [...(d.blockedFunctions ?? [])]);
}

/**
 * Locking clauses, as the unquoted words they are written with: Postgres and CockroachDB
 * `FOR UPDATE`, `FOR NO KEY UPDATE`, `FOR SHARE`, `FOR KEY SHARE`; MySQL and MariaDB
 * `FOR UPDATE`, `FOR SHARE` (MySQL), `LOCK IN SHARE MODE`. Matched on every lexer, at any
 * depth, because the engines allow them in subqueries and CTEs (#319).
 */
const LOCKING_CLAUSES: readonly (readonly string[])[] = [
  ["for", "update"],
  ["for", "no", "key", "update"],
  ["for", "share"],
  ["for", "key", "share"],
  ["lock", "in", "share", "mode"],
];

/**
 * T-SQL table hints that take or hold locks. Matched as unquoted words anywhere on the SQL
 * Server lexer, because SQL Server also takes them without `WITH` (`FROM t (UPDLOCK)`).
 * `NOLOCK`, `READUNCOMMITTED`, `READPAST`, `READCOMMITTEDLOCK` and `NOWAIT` stay allowed.
 */
const TSQL_LOCK_HINTS: ReadonlySet<string> = new Set([
  "updlock", "xlock", "holdlock", "paglock", "tablock", "tablockx", "rowlock", "serializable", "repeatableread",
]);

/** The first locking clause or T-SQL lock hint in the SQL, uppercase (`FOR SHARE`), or undefined. */
function findLockingRead(tokens: readonly SqlToken[], profile: SqlLexerProfile): string | undefined {
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.kind !== "word") continue;
    if (profile.id === "sqlserver" && TSQL_LOCK_HINTS.has(t.lower)) return `the table hint ${t.lower.toUpperCase()}`;
    for (const clause of LOCKING_CLAUSES) {
      if (clause.every((word, k) => tokens[i + k]?.kind === "word" && tokens[i + k]!.lower === word)) {
        return clause.join(" ").toUpperCase();
      }
    }
  }
  return undefined;
}

function isPunct(t: SqlToken | undefined, text: string): boolean {
  return t?.kind === "punct" && t.text === text;
}

function isAdjacentPunct(t: SqlToken, next: SqlToken | undefined, text: string): boolean {
  return isPunct(next, text) && next!.start === t.end;
}

/** First significant token, skipping leading `(` so `(SELECT …) UNION (SELECT …)` passes. */
function headToken(tokens: readonly SqlToken[]): SqlToken | undefined {
  return tokens.find((t) => !isPunct(t, "("));
}

function describeToken(t: SqlToken): string {
  if (t.kind === "comment") return "block comment";
  if (t.kind === "quoted_identifier") return "quoted identifier";
  if (t.quote?.startsWith("$")) return "dollar-quoted string";
  return "string literal";
}

/** Explanation of guardrails satisfied by a string already passing {@link validateSelectSql}. */
export type SelectGuardrailExplain = {
  statementKind: "select" | "with";
  checksVerified: readonly string[];
  remediationNote: string;
};

/** Build a structured summary for hosts/CLI `--explain`; input must already be validated. */
export function buildSelectGuardrailExplanation(validatedSql: string): SelectGuardrailExplain {
  const head = headToken(lexSql(validatedSql.trim(), GENERIC_LEXER));
  const statementKind: "select" | "with" = head?.lower === "with" ? "with" : "select";
  return {
    statementKind,
    checksVerified: [
      "non_empty_sql",
      "no_unterminated_literals_or_comments",
      "single_statement",
      "no_line_or_block_comments",
      "leading_select_or_with",
      "no_locking_reads",
      "no_blocked_write_or_ddl_keywords",
      "no_blocked_side_effect_functions",
    ],
    remediationNote:
      "Heuristic, lexer-based defense-in-depth checks only—not a SQL parser and not a security boundary. Execute generated SQL under a read-only database role, and review it before trusted execution.",
  };
}
