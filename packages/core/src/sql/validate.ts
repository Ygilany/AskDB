import { SqlValidationError, type SqlValidationRuleCode } from "../errors.js";
import { BUILT_IN_DIALECTS, type DialectSpec } from "./dialect-spec.js";
import {
  findEscapeStringContinuation,
  findEscapedByteString,
  findUnicodeEscapedIdentifier,
  GENERIC_LEXER,
  lexSql,
  type SqlLexerProfile,
  type SqlToken,
} from "./lexer.js";
import { isKnownEngine, readOnlyReadings } from "./readings.js";
import { AMBIGUOUS_TSQL_ADVICE, findAmbiguousTsqlText, findTsqlStatementBoundary } from "./tsql-batch.js";

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
 * 2. `SQL_STRING_CONTINUATION` and then `SQL_ESCAPED_BYTE_STRING`, Postgres lexer only
 *    (postgres, cockroachdb, and a dialect id that is no built-in engine) — an `E'…'` string
 *    continued on a later line, which Postgres reads with backslash escapes, and a `b'…'` byte
 *    string with a backslash or a continuation, which CockroachDB reads with them; past either,
 *    the tokens may not be the server's, so they run first (#703, #730).
 * 3. `SQL_UNTERMINATED` — a string, quoted identifier, dollar-quoted string, or block
 *    comment never closes. Fails closed rather than guessing where it ends.
 * 4. `SQL_MULTI_STATEMENT` — any `;` other than a single trailing one.
 * 5. `SQL_COMMENT` — any comment (`--`, `/* *\/`, and MySQL `#`).
 * 6. `SQL_NOT_SELECT_OR_WITH` — the first token (after any `(`) is not `SELECT`/`WITH`.
 * 7. `SQL_FORBIDDEN_KEYWORD`, Postgres lexer only — a `$N` parameter written against a word
 *    (`$1INTO`, `$1FOR`), which the lexer reads as one token, so the later checks can't see a
 *    keyword a server that ends the parameter at its last digit would read (#665).
 * 8. `SQL_MULTI_STATEMENT`, SQL Server lexer only (so also for a dialect id that is no
 *    built-in engine) — a second statement written without `;`, which T-SQL doesn't
 *    need, or code SQL Server may split differently from the lexer (see `tsql-batch.ts`).
 * 9. `SQL_LOCKING_READ` — a locking read, at any depth: `FOR UPDATE`, `FOR NO KEY UPDATE`,
 *    `FOR SHARE`, `FOR KEY SHARE` or `LOCK IN SHARE MODE` on every lexer, and on the SQL Server
 *    lexer a lock hint such as `UPDLOCK` or `HOLDLOCK` unquoted anywhere, or quoted alone in
 *    parentheses right after a name, at any depth and with trailing spaces, and any such name
 *    that isn't printable ASCII, which SQL Server may read as a hint (#319).
 * 10. `SQL_UNICODE_ESCAPED_IDENTIFIER`, Postgres lexer only (postgres, cockroachdb, and a
 *    dialect id that is no built-in engine) — a `U&"…"` identifier, whose escapes could spell
 *    a blocked function or a sensitive column that the later checks match by name (#692).
 * 11. `SQL_FORBIDDEN_KEYWORD` — an unquoted keyword from the shared denylist or the
 *    dialect's `extraForbiddenKeywords`.
 * 12. `SQL_FORBIDDEN_FUNCTION` — a call (`name(`) to a function in the dialect's
 *    `blockedFunctions` (side-effecting or file/network/sleep functions), and on every lexer
 *    `NEXT VALUE FOR`, which advances a sequence on MariaDB and SQL Server (#825).
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

  const keywords = denylistFor(dialect);
  // Unknown engine: every plausible reading of the SQL must be safe, against every built-in spec's functions.
  const functions = isKnownEngine(dialect)
    ? blockedFunctionsFor(dialect)
    : new Set([...blockedFunctionsFor(dialect), ...allBuiltInFunctions()]);
  let tokens: SqlToken[] = [];
  for (const profile of readOnlyReadings(dialect)) tokens = checkWithProfile(trimmed, profile, keywords, functions);

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

  // First: past these boundaries the tokens may not be the ones the server reads (#703, #730).
  if (profile.id === "postgres") {
    const continued = findEscapeStringContinuation(sql, tokens);
    if (continued) {
      throw validationError(
        "SQL_STRING_CONTINUATION",
        `An E'…' string continued on a later line is not allowed: generated SQL continues the E'…' string at offset ${continued.start}.`,
        "Postgres joins E'…' with the next '…' across a newline and reads both with backslash escapes, so the check can't tell where the string ends. Write one literal, or join the parts with ||.",
      );
    }
    const bytes = findEscapedByteString(sql, tokens);
    if (bytes) {
      throw validationError(
        "SQL_ESCAPED_BYTE_STRING",
        `A b'…' byte string with a backslash, or continued on a later line, is not allowed: generated SQL has one at offset ${bytes.start}.`,
        "CockroachDB reads b'…' with backslash escapes, also across a continuation, so the check can't tell where the string ends. Write the bytes as a hex string cast to bytea ('\\x00'::bytea).",
      );
    }
  }

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

  // Before the keyword and locking checks, which can't see a word inside the parameter token.
  const glued = profile.id === "postgres" ? tokens.find(isParameterAgainstWord) : undefined;
  if (glued) {
    throw validationError(
      "SQL_FORBIDDEN_KEYWORD",
      `A $N parameter written against a word is not allowed: generated SQL has '${glued.text}' at offset ${glued.start}.`,
      "A server that ends the parameter at its last digit reads the rest as a separate word, such as INTO or FOR, which the check can't see. Put a space after the parameter.",
    );
  }

  if (profile.id === "sqlserver") {
    const ambiguous = findAmbiguousTsqlText(sql, tokens);
    if (ambiguous) {
      throw validationError(
        "SQL_MULTI_STATEMENT",
        `Multiple SQL statements are not allowed: SQL Server may split code at ${ambiguous}, so the check can't tell where one statement ends.`,
        AMBIGUOUS_TSQL_ADVICE,
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
      "A locking read can hold locks that other sessions wait on until the host's transaction ends. Regenerate as a plain SELECT, without FOR UPDATE, FOR SHARE, LOCK IN SHARE MODE or a SQL Server lock hint such as UPDLOCK or HOLDLOCK. On SQL Server, quote a name that isn't plain ASCII ([Größe]), and qualify it when it's the only thing inside parentheses (COUNT(t.[Größe])).",
    );
  }

  if (profile.id === "postgres") {
    const escaped = findUnicodeEscapedIdentifier(tokens);
    if (escaped) {
      throw validationError(
        "SQL_UNICODE_ESCAPED_IDENTIFIER",
        `Unicode-escaped identifiers are not allowed: generated SQL uses ${escaped}.`,
        `Write the name in plain double quotes ("Größe"), or unquoted. A U&"…" name can spell a blocked function or a sensitive column with escapes the other checks don't decode.`,
      );
    }
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
    // A `:name` parameter token counts too: before `(` it's no placeholder, and in an array slice
    // (`[1:set_config(…)]`) Postgres reads the `:` as the separator and the rest as a call.
    const colonName = t.kind === "parameter" && t.text.startsWith(":");
    const nameLike =
      t.kind === "word" || t.kind === "quoted_identifier" || (t.kind === "string" && t.quote === '"') || colonName;
    if (!nameLike) return;
    const name = t.kind === "string" ? t.text.slice(1, -1).toLowerCase() : colonName ? t.lower.slice(1) : t.lower;
    if (functions.has(name) && isPunct(tokens[idx + 1], "(")) {
      throw validationError(
        "SQL_FORBIDDEN_FUNCTION",
        `Forbidden function in generated SQL: ${name}().`,
        `"${name}" has side effects (writes, file or network access, sleeping, session changes) and is blocked for this dialect. Remove the call.`,
      );
    }
  });

  // The standard spelling of a sequence's NEXTVAL(): MariaDB and SQL Server advance the sequence,
  // outside the transaction's rollback (#825). Postgres and SQLite don't parse it, so no lexer
  // loses a read by refusing it.
  if (tokens.some((_, i) => wordsAt(tokens, i, NEXT_VALUE_FOR))) {
    throw validationError(
      "SQL_FORBIDDEN_FUNCTION",
      "Forbidden function in generated SQL: NEXT VALUE FOR.",
      `NEXT VALUE FOR advances a sequence, which a read-only query must not do. Remove it.${SEQUENCE_READ_HINT[profile.id] ?? ""}`,
    );
  }

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
  if (checkedAsTsql(dialect)) for (const hint of TSQL_LOCK_HINTS) words.add(hint);
  return words;
}

/**
 * Whether `validateSelectSql` runs the SQL Server lexer, and so the T-SQL hint checks, for a
 * dialect: `sqlserver`, and an id that is no built-in engine family, which is checked every
 * engine's way. The NL→SQL prompt follows it (#319).
 */
export function checkedAsTsql(dialect: Pick<DialectSpec, "id" | "backslashEscapes">): boolean {
  return readOnlyReadings(dialect).some((profile) => profile.id === "sqlserver");
}

/**
 * The `SQL_FORBIDDEN_KEYWORD` denylist: the shared list and the spec's `extraForbiddenKeywords`,
 * plus every built-in spec's for an id that is no built-in engine family. The tenant check reads
 * SQL Server's as the verbs that start a T-SQL statement with no `;` before it.
 */
export function denylistFor(dialect: Pick<DialectSpec, "id" | "backslashEscapes" | "extraForbiddenKeywords">): Set<string> {
  const keywords = new Set([...BASE_FORBIDDEN, ...(dialect.extraForbiddenKeywords ?? [])].map((w) => w.toLowerCase()));
  if (!isKnownEngine(dialect)) for (const word of allBuiltInKeywords()) keywords.add(word.toLowerCase());
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

/** The standard spelling of a sequence's NEXTVAL(), refused on every lexer (#825). */
const NEXT_VALUE_FOR: readonly string[] = ["next", "value", "for"];

/**
 * What a query that only reads a sequence can use instead of `NEXT VALUE FOR`, by lexer: MariaDB's
 * readers return the value this session last drew, without changing the sequence. Postgres and
 * SQLite don't parse `NEXT VALUE FOR`, so they get no alternative.
 */
const SEQUENCE_READ_HINT: Partial<Record<SqlLexerProfile["id"], string>> = {
  mysql: " On MariaDB, PREVIOUS VALUE FOR or LASTVAL() returns the value this session last drew from the sequence, without changing it.",
  sqlserver: " On SQL Server, sys.sequences shows a sequence's current_value without changing it.",
};

/** Whether `words` appear as consecutive unquoted words starting at token `i`. */
function wordsAt(tokens: readonly SqlToken[], i: number, words: readonly string[]): boolean {
  return words.every((word, k) => tokens[i + k]?.kind === "word" && tokens[i + k]!.lower === word);
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
 * Server lexer, because SQL Server also takes them without `WITH` (`FROM t (UPDLOCK)`), and
 * quoted when one stands alone in parentheses right after a name, at any depth and with trailing
 * spaces, which SQL Server also reads as the hint (`FROM t ([UPDLOCK])`, `t (("UPDLOCK "))`).
 * SQL Server 2022 refused quoted hints in other positions: inside `WITH`, in a list, and after an
 * alias or a function call.
 * `NOLOCK`, `READUNCOMMITTED`, `READPAST`, `READCOMMITTEDLOCK` and `NOWAIT` stay allowed.
 */
const TSQL_LOCK_HINTS: ReadonlySet<string> = new Set([
  "updlock", "xlock", "holdlock", "paglock", "tablock", "tablockx", "rowlock", "serializable", "repeatableread",
]);

/** The first locking clause or T-SQL lock hint in the SQL, uppercase (`FOR SHARE`), or undefined. */
function findLockingRead(tokens: readonly SqlToken[], profile: SqlLexerProfile): string | undefined {
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    const hint = profile.id === "sqlserver" ? tsqlLockHint(tokens, i) : undefined;
    if (hint) return hint;
    if (t.kind !== "word") continue;
    for (const clause of LOCKING_CLAUSES) {
      if (wordsAt(tokens, i, clause)) return clause.join(" ").toUpperCase();
    }
  }
  return undefined;
}

/** Printable ASCII: the only spellings the hint check can match by name. */
const PRINTABLE_ASCII = /^[\x20-\x7e]*$/;

/**
 * What makes token `i` a lock hint, or undefined: an unquoted word, or a quoted name alone in
 * parentheses after a name, that spells a hint or isn't printable ASCII. SQL Server compares
 * hint names loosely: it ignores some characters (U+FEFF, U+200D, `Ș`) and reads others as
 * ASCII letters (`ʟ` as L), so only a printable-ASCII name can be checked by its spelling.
 */
function tsqlLockHint(tokens: readonly SqlToken[], i: number): string | undefined {
  const t = tokens[i]!;
  const quoted = t.kind === "quoted_identifier";
  if (!(t.kind === "word" || (quoted && isLoneQuotedHint(tokens, i)))) return undefined;
  if (!PRINTABLE_ASCII.test(t.value)) {
    return `the ${quoted ? "quoted name" : "unquoted name"} ${t.text}, which SQL Server may read as a lock hint`;
  }
  // SQL Server ignores trailing spaces when it compares a quoted name, so `[UPDLOCK ]` is the hint.
  // Past the ASCII check, a space is the only whitespace left, so `trimEnd()` strips just those.
  const name = quoted ? t.lower.trimEnd() : t.lower;
  return TSQL_LOCK_HINTS.has(name) ? `the table hint ${name.toUpperCase()}` : undefined;
}

/** `name ( [hint] )` or `name (( [hint] ))`: a quoted identifier alone in parentheses right after a name. */
function isLoneQuotedHint(tokens: readonly SqlToken[], i: number): boolean {
  let depth = 1;
  while (isPunct(tokens[i - depth], "(") && isPunct(tokens[i + depth], ")")) depth++;
  const before = tokens[i - depth];
  return depth > 1 && (before?.kind === "word" || before?.kind === "quoted_identifier");
}

function isPunct(t: SqlToken | undefined, text: string): boolean {
  return t?.kind === "punct" && t.text === text;
}

/**
 * A `$N` parameter with a word written right after its digits (`$1INTO`, `$1FOR`), which the
 * Postgres reading lexes as one token (#665). Postgres 15 and later reject it as trailing junk; a
 * server that ends the parameter at its last digit would read a keyword the check never saw, so it
 * is refused rather than guessed at.
 */
function isParameterAgainstWord(t: SqlToken): boolean {
  return t.kind === "parameter" && /^\$\d+\D/.test(t.text);
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
