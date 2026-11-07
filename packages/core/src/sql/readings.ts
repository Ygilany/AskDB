/**
 * How each SQL check reads a statement, per dialect: the lexer readings it must pass under. This
 * module is the one place that decides them (#815, ADR 0010's stage (c), "one shared analysis"),
 * and {@link readSql} lexes each reading once per statement, so a reading changes in one place.
 * The checks stay heuristics (ADR 0012).
 *
 * The sets differ by check. #815 moved them here unchanged; merging them would tighten some checks
 * and loosen others, so that is its own decision.
 *
 * | Check | A built-in engine | Any other id, or no dialect |
 * |---|---|---|
 * | read-only ({@link readOnlyReadings}) | the engine's profile | every engine's profile |
 * | sensitive ({@link sensitiveReadings}) | the engine's (Postgres family: plus CockroachDB's comment end) | the generic profile, plus each engine's that lexes cleanly |
 * | tenant: statements and calls ({@link tenantStatementReadings}) | the engine's (Postgres family: both comment ends) | every engine's, Postgres and MySQL with both string settings |
 * | tenant: predicates ({@link tenantCodeReadings}) | the engine's view | the standard, Postgres, MySQL and SQL Server views, the first two with both comment ends |
 * | placeholders ({@link placeholderReading}) | the engine's | the generic profile |
 * | Postgres-only forms (`postgresReadingProfiles` in `lexer.ts`) | the engine's, when it is on the Postgres lexer | Postgres's, with backslash escapes too when set |
 *
 * Every MySQL reading is taken twice by the tenant check, with `/*! … *\/` bodies as code and as
 * comments, since a server older than the comment's version skips the body. A `postgres` dialect
 * may point at CockroachDB, which is wire-compatible but ends a `--` comment only at `\n`, so the
 * Postgres family is read with both comment ends where that decides what is code.
 */
import { isBuiltInDialectId, type DialectSpec } from "./dialect-spec.js";
import { ENGINE_LEXER_PROFILES, GENERIC_LEXER, lexerProfileFor, lexSql, type SqlLexerProfile, type SqlToken } from "./lexer.js";

/** The parts of a dialect that decide how its SQL is read. */
export type ReadingDialect = Pick<DialectSpec, "id" | "backslashEscapes">;

/**
 * Whether `dialect` names a built-in engine family, which the checks read its own way. Any other
 * id is read every engine's way, and checked against every built-in spec's denylist.
 */
export function isKnownEngine(dialect: ReadingDialect): boolean {
  return lexerProfileFor(dialect) !== undefined;
}

/** A Postgres-family profile, ended at `\n` only the way CockroachDB ends a `--` comment. */
function asCockroachDb(profile: SqlLexerProfile): SqlLexerProfile {
  return { ...profile, lineCommentEndsAtLfOnly: true };
}

/**
 * The read-only check (`validateSelectSql`): the engine's profile, or every engine's. It refuses
 * every comment, so where a comment ends doesn't change its verdict.
 */
export function readOnlyReadings(dialect: ReadingDialect): readonly SqlLexerProfile[] {
  const profile = lexerProfileFor(dialect);
  return profile ? [profile] : ENGINE_LEXER_PROFILES;
}

/**
 * The sensitive check. With a built-in engine, its profile (for the Postgres family, the references
 * CockroachDB's comment end shows are added too). Otherwise the generic profile decides scope issues
 * (`primary`), and the references found under each engine's profile that lexes cleanly are added to
 * it (`union`), so a column one engine's quoting rules hide is still reported.
 */
export function sensitiveReadings(dialect: ReadingDialect | undefined): {
  primary: SqlLexerProfile;
  union: readonly SqlLexerProfile[];
} {
  const profile = dialect ? lexerProfileFor(dialect) : undefined;
  if (!profile) return { primary: GENERIC_LEXER, union: ENGINE_LEXER_PROFILES };
  return { primary: profile, union: profile.id === "postgres" ? [asCockroachDb(profile)] : [] };
}

/**
 * Every way a server may lex `sql` into statements, for the tenant check's statement and call
 * checks: the dialect's profile when it names a built-in engine, otherwise every engine's, and for
 * Postgres and MySQL both string settings (a backslash ends a literal under one and escapes the
 * quote under the other). A MySQL profile is read with its `/*!NNNNN … *\/` bodies as code and as
 * comments, since a server older than NNNNN skips them, and a Postgres-family one with both
 * comment ends.
 */
export function tenantStatementReadings(dialect: ReadingDialect | undefined): SqlLexerProfile[] {
  const known = dialect?.id !== undefined ? lexerProfileFor(dialect) : undefined;
  const profiles = known
    ? known.id === "postgres" ? [known, asCockroachDb(known)] : [known]
    : ENGINE_LEXER_PROFILES.flatMap((p) =>
        p.id === "postgres" || p.id === "mysql" ? [p, { ...p, backslashEscapes: !p.backslashEscapes }] : [p],
      );
  return bothExecutableCommentReadings(profiles);
}

/** A profile that reads `/*!NNNNN … *\/` bodies as code, also read with them as comments. */
function bothExecutableCommentReadings(profiles: readonly SqlLexerProfile[]): SqlLexerProfile[] {
  return profiles.flatMap((p) => (p.executableComments ? [p, { ...p, executableComments: false }] : [p]));
}

/** A reading the tenant check matches tables and predicates under. */
export type CodeViewReading = {
  readonly profile: SqlLexerProfile;
  /** `||` is logical OR (MySQL/MariaDB without `PIPES_AS_CONCAT`), not string concatenation. */
  readonly pipesAreOr: boolean;
};

/**
 * The tenant check's standard view: how its own scanner split code from strings and comments, kept
 * as a lexer profile (#815). `'…'` strings with `''` escapes; `"…"`, `` `…` `` and `[…]` quoted
 * names under every engine, where the first `]` ends a bracketed name; `--` and `/* *\/` comments,
 * never nested, where a line comment ends only at `\n`.
 */
const STANDARD_VIEW: SqlLexerProfile = {
  id: "generic",
  backslashEscapes: false,
  doubleQuote: "identifier",
  backtickIdentifiers: true,
  bracketIdentifiers: "simple",
  dollarQuotes: false,
  escapeStrings: false,
  hashComments: false,
  dashCommentNeedsSpace: false,
  nestedBlockComments: false,
  executableComments: false,
  atVariables: false,
  hashIdentifiers: false,
  tsqlLiterals: false,
  lineCommentEndsAtLfOnly: true,
  strictStringPrefixes: true,
};
/** The standard view, with Postgres `E'…'` escape strings and `$tag$…$tag$` strings. */
const POSTGRES_VIEW: SqlLexerProfile = { ...STANDARD_VIEW, id: "postgres", escapeStrings: true, dollarQuotes: true };
/**
 * The standard view, read the MySQL way: `"…"` is a string, backslash escapes, `#` comments, `--`
 * only before whitespace, and `/*! … *\/` bodies as code.
 */
const MYSQL_VIEW: SqlLexerProfile = {
  ...STANDARD_VIEW,
  id: "mysql",
  doubleQuote: "string",
  backslashEscapes: true,
  hashComments: true,
  dashCommentNeedsSpace: true,
  executableComments: true,
};
/** A view whose line comments end at `\r` too, as on Postgres and SQL Server. */
const crEnds = (view: SqlLexerProfile): SqlLexerProfile => ({ ...view, lineCommentEndsAtLfOnly: false });
/**
 * The standard view, read the SQL Server way (#623): a line comment ends at `\r` too, and a name or
 * number ends where SQL Server ends it (`tsqlLiterals`: after `0x` or `1E`, and at whitespace such
 * as U+00A0, U+200B and U+0085), so a keyword written right after one is a word of its own.
 */
const SQLSERVER_VIEW: SqlLexerProfile = { ...crEnds(STANDARD_VIEW), id: "sqlserver", tsqlLiterals: true };

/**
 * The tenant check's predicate readings. A built-in engine gets its own view: the MySQL one twice,
 * with executable comments as code and as comments; the Postgres one with both comment ends; the
 * SQL Server one. Backslash escapes follow the spec as the lexer reads it: an unset value on MySQL
 * or MariaDB is the server default, on. Any other id, or none, gets the standard and Postgres views
 * with both comment ends, the MySQL view and the SQL Server view: a table counts as referenced when
 * any of them sees it, a predicate only when every one does.
 */
export function tenantCodeReadings(dialect: ReadingDialect | undefined): CodeViewReading[] {
  const views = (profiles: readonly SqlLexerProfile[]) =>
    bothExecutableCommentReadings(profiles).map((profile) => ({ profile, pipesAreOr: profile.id === "mysql" }));
  if (dialect === undefined || !isBuiltInDialectId(dialect.id)) {
    return views([STANDARD_VIEW, crEnds(STANDARD_VIEW), POSTGRES_VIEW, crEnds(POSTGRES_VIEW), MYSQL_VIEW, SQLSERVER_VIEW]);
  }
  const mysqlFamily = dialect.id === "mysql" || dialect.id === "mariadb";
  const backslashEscapes = mysqlFamily ? dialect.backslashEscapes !== false : dialect.backslashEscapes === true;
  const engine =
    mysqlFamily
      ? [MYSQL_VIEW]
      : dialect.id === "postgres" || dialect.id === "cockroachdb"
        ? [POSTGRES_VIEW, crEnds(POSTGRES_VIEW)]
        : dialect.id === "sqlserver"
          ? [SQLSERVER_VIEW]
          : [STANDARD_VIEW];
  return views(engine.map((view) => ({ ...view, backslashEscapes })));
}

/** Placeholder scans (`tokenizeSqlSpans`): the engine's profile, or the generic one. */
export function placeholderReading(dialect: ReadingDialect | undefined): SqlLexerProfile {
  return (dialect && lexerProfileFor(dialect)) ?? GENERIC_LEXER;
}

/** A statement, and its tokens under each reading a check asks for, each lexed once. */
export type SqlRead = {
  readonly sql: string;
  tokens(profile: SqlLexerProfile): readonly SqlToken[];
};

/** Read `sql`: {@link SqlRead.tokens} lexes it under a profile the first time it is asked for one. */
export function readSql(sql: string): SqlRead {
  const lexed = new Map<string, readonly SqlToken[]>();
  return {
    sql,
    tokens(profile) {
      const key = profileKey(profile);
      let tokens = lexed.get(key);
      if (tokens === undefined) {
        tokens = lexSql(sql, profile);
        lexed.set(key, tokens);
      }
      return tokens;
    },
  };
}

/** Two profiles with the same rules lex the same tokens. */
function profileKey(p: SqlLexerProfile): string {
  return [
    p.id, p.backslashEscapes, p.doubleQuote, p.backtickIdentifiers, p.bracketIdentifiers, p.dollarQuotes,
    p.escapeStrings, p.hashComments, p.dashCommentNeedsSpace, p.nestedBlockComments, p.executableComments,
    p.atVariables, p.hashIdentifiers, p.tsqlLiterals, p.lineCommentEndsAtLfOnly === true, p.strictStringPrefixes === true,
  ].join("|");
}
