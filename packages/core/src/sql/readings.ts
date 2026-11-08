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
 * | tenant: predicates ({@link tenantCodeReadings}) | the engine's view | the standard, Postgres, MySQL and SQL Server views, the first two with both comment ends; the Postgres and SQL Server views with block comments nested and not |
 * | placeholders ({@link placeholderReading}) | the engine's | the generic profile |
 * | names outside printable ASCII, tenant and sensitive ({@link unmatchedNonAsciiName}) | `sqlserver`: the engine's; any other engine: none | as for tenant statements |
 * | names some engine folds into ASCII or not in NFC, tenant ({@link nameEnginesFoldApart}) | the engine's, as for tenant statements | as for tenant statements |
 * | `'…'` read as a name or an alias, tenant and sensitive ({@link stringsSqliteReadsAsNames}) | `sqlite`: its readings; any other engine: none | the generic and standard readings, and SQLite's |
 * | Postgres-only forms (`postgresReadingProfiles` in `lexer.ts`) | the engine's, when it is on the Postgres lexer | Postgres's, with backslash escapes too when set |
 *
 * Every MySQL reading is taken twice by the tenant check, with `/*! … *\/` bodies as code and as
 * comments, since a server older than the comment's version skips the body. Its Postgres and SQL
 * Server views, which nest block comments as those engines do, are taken twice too, with the
 * comments nested and not, so a predicate counts only where the two agree on what is code. A `postgres` dialect
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

/** Printable ASCII, the only characters a name can hold for the checks to match it by spelling everywhere. */
const PRINTABLE_ASCII = /^[\x20-\x7e]*$/;

/**
 * The first name in `read`, quoted or not, that holds a character outside printable ASCII and isn't
 * one of `known` exactly, as written; undefined when there is none. SQL Server resolves a name
 * through the database collation, which ignores some characters (U+200D, U+FEFF, any emoji) and
 * reads others as ASCII letters (fullwidth letters, small capitals), so such a name can reach a
 * table or column that the tenant and sensitive checks, which match names by spelling, never see.
 * Read under `sqlserver`, and under any id that is no built-in engine or no dialect, each reading
 * from {@link tenantStatementReadings}; the other built-in engines compare such a name as written.
 */
export function unmatchedNonAsciiName(
  read: SqlRead,
  dialect: ReadingDialect | undefined,
  known: ReadonlySet<string>,
): string | undefined {
  if (dialect !== undefined && isBuiltInDialectId(dialect.id) && dialect.id !== "sqlserver") return undefined;
  for (const profile of tenantStatementReadings(dialect)) {
    for (const token of read.tokens(profile)) {
      const name = token.kind === "word" ? token.text : token.kind === "quoted_identifier" ? token.value : undefined;
      if (name !== undefined && !PRINTABLE_ASCII.test(name) && !known.has(name)) return token.text;
    }
  }
  return undefined;
}

/**
 * Letters some engine folds into an ASCII letter: U+0130 (CockroachDB and MySQL read `i`), U+0131
 * and U+017F (`I` and `S` upper-cased), and U+212A KELVIN SIGN (`k`).
 */
const FOLDS_INTO_ASCII = /[\u0130\u0131\u017F\u212A]/;

/**
 * The first name in `read`, quoted or not, under any of its readings, that holds a letter some
 * engine folds into an ASCII letter ({@link FOLDS_INTO_ASCII}) or that isn't in NFC, which
 * CockroachDB normalizes a name to, and isn't one of `known` exactly; undefined when there is none.
 * The checks can't match such a name the way every engine does, so it may reach a table or column
 * they never see. Read under every dialect.
 */
export function nameEnginesFoldApart(
  read: SqlRead,
  dialect: ReadingDialect | undefined,
  known: ReadonlySet<string>,
): string | undefined {
  for (const profile of tenantStatementReadings(dialect)) {
    for (const token of read.tokens(profile)) {
      const name = token.kind === "word" ? token.text : token.kind === "quoted_identifier" ? token.value : undefined;
      if (name !== undefined && (FOLDS_INTO_ASCII.test(name) || name !== name.normalize("NFC")) && !known.has(name)) return token.text;
    }
  }
  return undefined;
}

/** Whether `profile` may be SQLite's reading: SQLite's own, or the generic and standard ones a dialect that may be SQLite gets. */
export function mayBeSqlite(profile: SqlLexerProfile): boolean {
  return profile.id === "sqlite" || profile.id === "generic";
}

/** Words that start a query right after its `(`. */
export const QUERY_START_WORDS: ReadonlySet<string> = new Set(["select", "with", "values", "table"]);

/** Words that start a clause other than `FROM`, so a `,` after one is in no `FROM` list. */
const NOT_A_FROM_LIST = new Set(["select", "where", "group", "having", "order", "limit", "offset", "window", "values", "returning", "union", "intersect", "except", "set", "with"]);

/**
 * The indices in `tokens` of the `'…'` strings that SQLite reads as names. SQLite takes a
 * single-quoted literal where only a name may stand as that name, so `FROM 'orders'` reads the
 * table `orders`. A string counts right after `FROM`, `JOIN` or `IN` (`IN 'orders'` reads a table),
 * after a `,` in a `FROM` list, beside a `.` (`main.'orders'`, `'main'.orders`), or right after a
 * `(` that follows `FROM`, `JOIN`, a `FROM`-list comma or another such `(`, and opens no query
 * (`FROM ('orders')`); a comma inside such parentheses is a `FROM`-list comma too. With `withAliases`, it also
 * counts right after a table or CTE reference, after the `)` of such parentheses (`(orders) 'o'`),
 * or after `AS` following one, where it is that read's alias (`FROM orders 'o'`). The tenant and sensitive checks read such a
 * string as a quoted name under a reading that {@link mayBeSqlite may be SQLite's}; only the tenant
 * check reads aliases, since the sensitive check already fails closed on a qualifier it can't bind.
 */
export function stringsSqliteReadsAsNames(tokens: readonly SqlToken[], withAliases: boolean): ReadonlySet<number> {
  const code = [...tokens.keys()].filter((i) => tokens[i]!.kind !== "comment");
  const at = (j: number) => (j >= 0 && j < code.length ? tokens[code[j]!] : undefined);
  const is = (t: SqlToken | undefined, kind: "word" | "punct", text: string) => t?.kind === kind && t.lower === text;
  const inFromList = (comma: number) => {
    let depth = 0;
    for (let j = comma - 1; j >= 0; j--) {
      const t = at(j)!;
      if (is(t, "punct", ")")) depth++;
      else if (is(t, "punct", "(")) {
        // A comma inside a source's parentheses (`FROM (lookup_states, 'orders')`) is a FROM-list comma too.
        if (depth === 0) return sourceParens.has(j);
        depth--;
      } else if (depth === 0 && is(t, "punct", ";")) return false;
      else if (depth === 0 && t.kind === "word") {
        if (t.lower === "from") return true;
        if (NOT_A_FROM_LIST.has(t.lower)) return false;
      }
    }
    return false;
  };
  const names = new Set<number>();
  /** Positions in `code` of the names that stand in a table's place: `FROM orders`, `JOIN main.orders`, and the `)` of `(orders)`. */
  const sources = new Set<number>();
  /** Positions of the `(`s where a source starts that open no query (`FROM (orders)`, `JOIN ((orders))`). */
  const sourceParens = new Set<number>();
  const opens: number[] = [];
  for (let j = 0; j < code.length; j++) {
    const t = at(j)!;
    const prev = at(j - 1);
    const plainString = t.kind === "string" && t.text.startsWith("'");
    const atSourceStart =
      is(prev, "word", "from") || is(prev, "word", "join") || (is(prev, "punct", ",") && inFromList(j - 1)) ||
      (is(prev, "punct", "(") && sourceParens.has(j - 1));
    if (is(t, "punct", "(")) {
      const next = at(j + 1);
      const opensQuery = next?.kind === "word" && QUERY_START_WORDS.has(next.lower);
      if (atSourceStart && !opensQuery) sourceParens.add(j);
      opens.push(j);
      continue;
    }
    if (is(t, "punct", ")")) {
      const open = opens.pop();
      if (open !== undefined && sourceParens.has(open)) sources.add(j);
      continue;
    }
    const startsSource = atSourceStart || (is(prev, "punct", ".") && sources.has(j - 2));
    if (startsSource && (t.kind === "word" || t.kind === "quoted_identifier" || plainString)) sources.add(j);
    if (!plainString) continue;
    const alias = withAliases && (sources.has(j - 1) || (is(prev, "word", "as") && sources.has(j - 2)));
    const named =
      alias || is(prev, "punct", ".") || is(at(j + 1), "punct", ".") ||
      is(prev, "word", "from") || is(prev, "word", "join") || is(prev, "word", "in") ||
      (is(prev, "punct", ",") && inFromList(j - 1)) || (is(prev, "punct", "(") && sourceParens.has(j - 1));
    if (named) names.add(code[j]!);
  }
  return names;
}

/** A view that nests block comments, also read with them ending at the first `*\/`. */
function bothBlockCommentReadings(profiles: readonly SqlLexerProfile[]): SqlLexerProfile[] {
  return profiles.flatMap((p) => (p.nestedBlockComments ? [p, { ...p, nestedBlockComments: false }] : [p]));
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
/**
 * The standard view, with Postgres `E'…'` escape strings, `$tag$…$tag$` strings, and block comments
 * nested the way Postgres and CockroachDB nest them.
 */
const POSTGRES_VIEW: SqlLexerProfile = {
  ...STANDARD_VIEW,
  id: "postgres",
  escapeStrings: true,
  dollarQuotes: true,
  nestedBlockComments: true,
};
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
 * The standard view, read the SQL Server way (#623): a line comment ends at `\r` too, a name or
 * number ends where SQL Server ends it (`tsqlLiterals`: after `0x` or `1E`, and at whitespace such
 * as U+00A0, U+200B and U+0085), so a keyword written right after one is a word of its own, `]]`
 * inside a bracketed name is an escaped `]`, and block comments nest.
 */
const SQLSERVER_VIEW: SqlLexerProfile = {
  ...crEnds(STANDARD_VIEW),
  id: "sqlserver",
  tsqlLiterals: true,
  bracketIdentifiers: "doubled",
  nestedBlockComments: true,
};

/**
 * The tenant check's predicate readings. A built-in engine gets its own view: the MySQL one twice,
 * with executable comments as code and as comments; the Postgres one with both comment ends; the
 * SQL Server one. The Postgres and SQL Server views nest block comments, and each is read again with
 * them not nested. Backslash escapes follow the spec as the lexer reads it: an unset value on MySQL
 * or MariaDB is the server default, on. Any other id, or none, gets the standard and Postgres views
 * with both comment ends, the MySQL view and the SQL Server view: a table counts as referenced when
 * any of them sees it, a predicate only when every one does.
 */
export function tenantCodeReadings(dialect: ReadingDialect | undefined): CodeViewReading[] {
  const views = (profiles: readonly SqlLexerProfile[]) =>
    bothExecutableCommentReadings(bothBlockCommentReadings(profiles)).map((profile) => ({ profile, pipesAreOr: profile.id === "mysql" }));
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
