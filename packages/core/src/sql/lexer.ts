/**
 * Dialect-aware SQL lexer shared by the read-only validator, the sensitive-identifier
 * guardrail, and the placeholder scanner.
 *
 * It only splits SQL into tokens — it does not parse. Its job is to agree with the
 * target engine about where strings, quoted identifiers, and comments begin and end,
 * because every downstream check ("is there a second statement?", "is `DELETE` a
 * keyword here?", "is `ssn` a column reference?") depends on that boundary. Rules per
 * engine:
 *
 * | Construct                 | Postgres | MySQL/MariaDB          | SQL Server | SQLite |
 * |---------------------------|----------|------------------------|------------|--------|
 * | `'…'` backslash escapes   | no       | yes (`backslashEscapes`) | no       | no     |
 * | `E'…'` backslash escapes  | yes      | —                      | —          | —      |
 * | `$tag$…$tag$`             | yes      | —                      | —          | —      |
 * | `"…"`                     | ident    | string                 | ident      | ident  |
 * | `` `…` ``                 | —        | ident                  | —          | ident  |
 * | `[…]`                     | —        | —                      | ident (`]]`) | ident |
 * | `#` line comment          | —        | yes                    | —          | —      |
 * | `--` line comment         | yes      | only before whitespace | yes        | yes    |
 * | nested `/* … *\/`         | yes      | no (`/*! … *\/` runs)  | yes        | no     |
 * | `0x`, `1E`, `$`/`€` money | —        | —                      | literal    | —      |
 * | U+00A0 etc. end a name    | —        | —                      | yes        | —      |
 * | `@` continues a name      | —        | —                      | yes        | —      |
 *
 * The last three rows are `tsqlLiterals`; U+FEFF does not end a SQL Server name.
 *
 * The lexer never throws: a string, quoted identifier, or comment that runs off the end
 * of the input is returned with `unterminated: true` so callers can fail closed.
 */
import type { DialectSpec } from "./dialect-spec.js";

export type SqlLexerProfileId = "postgres" | "mysql" | "sqlserver" | "sqlite" | "generic";

export type SqlLexerProfile = {
  id: SqlLexerProfileId;
  /** `'…'` (and MySQL `"…"`) treat backslash as an escape character. */
  backslashEscapes: boolean;
  /** Whether `"…"` is a quoted identifier (ANSI) or a string literal (MySQL default mode). */
  doubleQuote: "identifier" | "string";
  backtickIdentifiers: boolean;
  /** `[…]` quoted identifiers. `"doubled"` accepts `]]` as an escaped `]` (SQL Server). */
  bracketIdentifiers: false | "simple" | "doubled";
  /** Postgres `$tag$ … $tag$` strings. */
  dollarQuotes: boolean;
  /** Postgres `E'…'` strings with backslash escapes. */
  escapeStrings: boolean;
  /** MySQL `#` line comments. */
  hashComments: boolean;
  /** MySQL: `--` starts a comment only when followed by whitespace, a control char, or EOF. */
  dashCommentNeedsSpace: boolean;
  nestedBlockComments: boolean;
  /** MySQL/MariaDB `/*! … *\/` and `/*M! … *\/`: the body is executed, so it is lexed as code. */
  executableComments: boolean;
  /** `@name` / `@@name` variables and parameters. Off for Postgres, where `@` is an operator. */
  atVariables: boolean;
  /** SQL Server `#temp` / `##temp` table names. */
  hashIdentifiers: boolean;
  /**
   * SQL Server's token ends: `0x` with no hex digits, an exponent with no digits (`1E`,
   * `1E+`), and money literals that start with a currency symbol (`$`, `$1.5`, `€`) are
   * complete literals; U+200B and U+0085 are whitespace; and a name or variable continues
   * through `@` and ends at any whitespace character except U+FEFF. A keyword written right after one of these
   * is its own token, as it is to SQL Server.
   */
  tsqlLiterals: boolean;
};

export const POSTGRES_LEXER: SqlLexerProfile = {
  id: "postgres",
  backslashEscapes: false,
  doubleQuote: "identifier",
  backtickIdentifiers: false,
  bracketIdentifiers: false,
  dollarQuotes: true,
  escapeStrings: true,
  hashComments: false,
  dashCommentNeedsSpace: false,
  nestedBlockComments: true,
  executableComments: false,
  atVariables: false,
  hashIdentifiers: false,
  tsqlLiterals: false,
};

export const MYSQL_LEXER: SqlLexerProfile = {
  id: "mysql",
  backslashEscapes: true,
  doubleQuote: "string",
  backtickIdentifiers: true,
  bracketIdentifiers: false,
  dollarQuotes: false,
  escapeStrings: false,
  hashComments: true,
  dashCommentNeedsSpace: true,
  nestedBlockComments: false,
  executableComments: true,
  atVariables: true,
  hashIdentifiers: false,
  tsqlLiterals: false,
};

export const SQLSERVER_LEXER: SqlLexerProfile = {
  id: "sqlserver",
  backslashEscapes: false,
  doubleQuote: "identifier",
  backtickIdentifiers: false,
  bracketIdentifiers: "doubled",
  dollarQuotes: false,
  escapeStrings: false,
  hashComments: false,
  dashCommentNeedsSpace: false,
  nestedBlockComments: true,
  executableComments: false,
  atVariables: true,
  hashIdentifiers: true,
  tsqlLiterals: true,
};

export const SQLITE_LEXER: SqlLexerProfile = {
  id: "sqlite",
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
  atVariables: true,
  hashIdentifiers: false,
  tsqlLiterals: false,
};

/**
 * Dialect-agnostic profile for callers that have no dialect (the tenant placeholder
 * path, the sensitive guardrail when no dialect is supplied). Recognizes the union of
 * quoting forms — `'…'`, `E'…'`, `$tag$…$tag$`, `"…"`, `` `…` ``, `[…]` — with the
 * escape rules the owning engine uses, and standard `--` / `/* *\/` comments.
 */
export const GENERIC_LEXER: SqlLexerProfile = {
  id: "generic",
  backslashEscapes: false,
  doubleQuote: "identifier",
  backtickIdentifiers: true,
  bracketIdentifiers: "doubled",
  dollarQuotes: true,
  escapeStrings: true,
  hashComments: false,
  dashCommentNeedsSpace: false,
  nestedBlockComments: false,
  executableComments: false,
  atVariables: true,
  hashIdentifiers: false,
  tsqlLiterals: false,
};

/** Every engine-specific profile. Used when the dialect is unknown and each reading must be safe. */
export const ENGINE_LEXER_PROFILES: readonly SqlLexerProfile[] = [
  POSTGRES_LEXER,
  MYSQL_LEXER,
  SQLSERVER_LEXER,
  SQLITE_LEXER,
];

/**
 * The lexer profile for a dialect, or `undefined` when the id is not a built-in engine
 * family (callers should then check every profile in {@link ENGINE_LEXER_PROFILES}).
 *
 * `backslashEscapes` on the spec is honored: MySQL with `NO_BACKSLASH_ESCAPES` sets it
 * to `false`; Postgres with `standard_conforming_strings = off` sets it to `true`.
 * An unset value on a MySQL-family spec means the server default (escapes on).
 */
export function lexerProfileFor(
  dialect: Pick<DialectSpec, "id" | "backslashEscapes">,
): SqlLexerProfile | undefined {
  switch (dialect.id as string) {
    case "postgres":
    case "cockroachdb":
      return dialect.backslashEscapes === true
        ? { ...POSTGRES_LEXER, backslashEscapes: true }
        : POSTGRES_LEXER;
    case "mysql":
    case "mariadb":
      return dialect.backslashEscapes === false
        ? { ...MYSQL_LEXER, backslashEscapes: false }
        : MYSQL_LEXER;
    case "sqlserver":
      return SQLSERVER_LEXER;
    case "sqlite":
      return SQLITE_LEXER;
    default:
      return undefined;
  }
}

export type SqlTokenKind =
  /** Unquoted identifier or keyword. */
  | "word"
  | "quoted_identifier"
  | "string"
  | "number"
  /** `$1`, `:name`, `@name`, `@@name`. */
  | "parameter"
  /** Any other single character, plus `::`. Includes `(`, `)`, `,`, `.`, `;`. */
  | "punct"
  | "comment";

export type SqlToken = {
  kind: SqlTokenKind;
  /** Exact source text of the token. */
  text: string;
  /**
   * `word`: the text as written. `quoted_identifier`: the unescaped name.
   * Everything else: same as `text`.
   */
  value: string;
  /** Lower-cased `value`, for case-insensitive keyword and name matching. */
  lower: string;
  start: number;
  end: number;
  /** Opening delimiter for strings and quoted identifiers (`'`, `"`, `` ` ``, `[`, `$tag$`). */
  quote?: string;
  /**
   * The closing delimiter was never found; the token runs to the end of the input. On a
   * MySQL `/*!` opener it means the matching `*\/` never came (the body is still lexed
   * as code after it).
   */
  unterminated?: true;
};

const WORD_START = /[A-Za-z_\u0080-￿]/;
const WORD_CHAR = /[A-Za-z0-9_$\u0080-￿]/;
const DIGIT = /[0-9]/;
const HEX = /[0-9A-Fa-f]/;
/** Currency symbols. SQL Server starts a money literal with one (its list is a subset). */
const CURRENCY = /\p{Sc}/u;
/**
 * Characters SQL Server reads as whitespace that `\s` does not match. With `\s` minus
 * U+FEFF they are the only characters at or above U+0080 that end a T-SQL name or
 * number (every BMP character probed on SQL Server 2022, #327); U+FEFF continues a name.
 */
const TSQL_EXTRA_SPACE = /[\u200b\u0085]/;
const DOLLAR_TAG = /^\$([A-Za-z_\u0080-￿][A-Za-z0-9_\u0080-￿]*)?\$/;

/**
 * Whether the `--` at `i` starts a line comment. It always does, except on MySQL/MariaDB
 * (`needsSpace`), where it must be followed by whitespace, a control character, or the end
 * of the statement: there `--1` is two minus signs and a number.
 */
export function startsDashComment(sql: string, i: number, needsSpace: boolean): boolean {
  if (sql[i] !== "-" || sql[i + 1] !== "-") return false;
  const after = sql[i + 2];
  return !needsSpace || after === undefined || /[\s\x00-\x1f]/.test(after);
}

/** Split `sql` into tokens under `profile`. Whitespace is dropped; comments are kept. */
export function lexSql(sql: string, profile: SqlLexerProfile): SqlToken[] {
  const tokens: SqlToken[] = [];
  const n = sql.length;
  let i = 0;
  /** Index in `tokens` of the open MySQL `/*! … *\/` executable-comment opener, or -1. */
  let executableOpener = -1;

  const isSpace = (c: string): boolean => /\s/.test(c) || (profile.tsqlLiterals && TSQL_EXTRA_SPACE.test(c));
  /**
   * `WORD_CHAR`, except that a SQL Server name also continues through `@` (`a@b` is one
   * name, as `a$b` and `a#b` are) and ends at Unicode whitespace other than U+FEFF.
   */
  const isWordChar = (c: string): boolean =>
    (WORD_CHAR.test(c) || (profile.tsqlLiterals && c === "@")) &&
    !(profile.tsqlLiterals && c !== "\ufeff" && isSpace(c));

  const push = (
    kind: SqlTokenKind,
    start: number,
    end: number,
    extra?: { value?: string; quote?: string; unterminated?: boolean },
  ): void => {
    const text = sql.slice(start, end);
    const value = extra?.value ?? text;
    const token: SqlToken = { kind, text, value, lower: value.toLowerCase(), start, end };
    if (extra?.quote !== undefined) token.quote = extra.quote;
    if (extra?.unterminated) token.unterminated = true;
    tokens.push(token);
  };

  /**
   * Scan a delimited run starting after the opening delimiter at `from`. `close` doubled
   * is always an escaped delimiter; `backslash` additionally makes `\x` an escape.
   */
  const scanDelimited = (
    from: number,
    close: string,
    backslash: boolean,
  ): { end: number; value: string; terminated: boolean } => {
    let j = from;
    let value = "";
    while (j < n) {
      const c = sql[j]!;
      if (backslash && c === "\\") {
        value += sql.slice(j, j + 2);
        j += 2;
        continue;
      }
      if (c === close) {
        if (sql[j + 1] === close) {
          value += close;
          j += 2;
          continue;
        }
        return { end: j + 1, value, terminated: true };
      }
      value += c;
      j++;
    }
    return { end: n, value, terminated: false };
  };

  const lexString = (start: number, quoteAt: number, backslash: boolean, kind: SqlTokenKind): void => {
    const q = sql[quoteAt]!;
    const r = scanDelimited(quoteAt + 1, q, backslash);
    push(kind, start, Math.min(r.end, n), {
      quote: q,
      ...(kind === "quoted_identifier" ? { value: r.value } : {}),
      unterminated: !r.terminated,
    });
    i = r.end;
  };

  while (i < n) {
    const ch = sql[i]!;
    const next = sql[i + 1];

    if (isSpace(ch)) {
      i++;
      continue;
    }

    // ---- comments -------------------------------------------------------
    if (ch === "-" && next === "-") {
      if (startsDashComment(sql, i, profile.dashCommentNeedsSpace)) {
        let j = i + 2;
        while (j < n && sql[j] !== "\n" && sql[j] !== "\r") j++;
        push("comment", i, j);
        i = j;
        continue;
      }
    }
    if (ch === "#" && profile.hashComments) {
      let j = i + 1;
      while (j < n && sql[j] !== "\n" && sql[j] !== "\r") j++;
      push("comment", i, j);
      i = j;
      continue;
    }
    if (ch === "*" && next === "/" && executableOpener !== -1) {
      push("comment", i, i + 2);
      executableOpener = -1;
      i += 2;
      continue;
    }
    if (ch === "/" && next === "*") {
      if (profile.executableComments && executableOpener === -1) {
        const exec = /^\/\*M?!\d*/.exec(sql.slice(i));
        if (exec) {
          executableOpener = tokens.length;
          push("comment", i, i + exec[0].length);
          i += exec[0].length;
          continue;
        }
      }
      let j = i + 2;
      let depth = 1;
      while (j < n) {
        if (sql[j] === "*" && sql[j + 1] === "/") {
          depth--;
          j += 2;
          if (depth === 0) break;
          continue;
        }
        if (profile.nestedBlockComments && sql[j] === "/" && sql[j + 1] === "*") {
          depth++;
          j += 2;
          continue;
        }
        j++;
      }
      push("comment", i, Math.min(j, n), { unterminated: depth > 0 });
      i = j;
      continue;
    }

    // ---- strings and quoted identifiers ---------------------------------
    if (ch === "'") {
      lexString(i, i, profile.backslashEscapes, "string");
      continue;
    }
    if (ch === '"') {
      if (profile.doubleQuote === "identifier") lexString(i, i, false, "quoted_identifier");
      else lexString(i, i, profile.backslashEscapes, "string");
      continue;
    }
    if (ch === "`" && profile.backtickIdentifiers) {
      lexString(i, i, false, "quoted_identifier");
      continue;
    }
    if (ch === "[" && profile.bracketIdentifiers) {
      let j = i + 1;
      let value = "";
      let terminated = false;
      while (j < n) {
        if (sql[j] === "]") {
          if (profile.bracketIdentifiers === "doubled" && sql[j + 1] === "]") {
            value += "]";
            j += 2;
            continue;
          }
          j++;
          terminated = true;
          break;
        }
        value += sql[j];
        j++;
      }
      push("quoted_identifier", i, j, { value, quote: "[", unterminated: !terminated });
      i = j;
      continue;
    }
    // SQL Server money: a currency symbol, then optional digits (`$`, `$1.5`, `€2`). `$`
    // before a letter is a pseudocolumn (`$action`), lexed below as a parameter.
    if (profile.tsqlLiterals && CURRENCY.test(ch) && !(ch === "$" && next !== undefined && WORD_START.test(next))) {
      let j = i + 1;
      while (j < n && DIGIT.test(sql[j]!)) j++;
      if (sql[j] === ".") {
        j++;
        while (j < n && DIGIT.test(sql[j]!)) j++;
      }
      push("number", i, j);
      i = j;
      continue;
    }
    if (ch === "$") {
      if (profile.dollarQuotes) {
        const tag = DOLLAR_TAG.exec(sql.slice(i));
        if (tag) {
          const opener = tag[0]!;
          const closeAt = sql.indexOf(opener, i + opener.length);
          const end = closeAt === -1 ? n : closeAt + opener.length;
          push("string", i, end, { quote: opener, unterminated: closeAt === -1 });
          i = end;
          continue;
        }
      }
      if (next !== undefined && (DIGIT.test(next) || (!profile.dollarQuotes && WORD_START.test(next)))) {
        let j = i + 1;
        while (j < n && isWordChar(sql[j]!) && sql[j] !== "$") j++;
        push("parameter", i, j);
        i = j;
        continue;
      }
    }

    // ---- words (and prefixed string literals) ---------------------------
    if (WORD_START.test(ch) || (ch === "#" && profile.hashIdentifiers && next !== undefined && (next === "#" || WORD_START.test(next)))) {
      let j = i + 1;
      while (j < n && (isWordChar(sql[j]!) || (profile.hashIdentifiers && sql[j] === "#"))) j++;
      const word = sql.slice(i, j);
      if (sql[j] === "'" && j - i === 1) {
        const prefix = word.toLowerCase();
        if (prefix === "e" && profile.escapeStrings) {
          lexString(i, j, true, "string");
          continue;
        }
        if (prefix === "n" || prefix === "x" || prefix === "b") {
          lexString(i, j, profile.backslashEscapes, "string");
          continue;
        }
      }
      push("word", i, j);
      i = j;
      continue;
    }

    // ---- numbers --------------------------------------------------------
    if (DIGIT.test(ch) || (ch === "." && next !== undefined && DIGIT.test(next))) {
      let j = i;
      if (ch === "0" && (next === "x" || next === "X") && (profile.tsqlLiterals || HEX.test(sql[i + 2] ?? ""))) {
        j = i + 2;
        while (j < n && HEX.test(sql[j]!)) j++;
      } else {
        while (j < n && DIGIT.test(sql[j]!)) j++;
        if (sql[j] === "." && sql[j + 1] !== ".") {
          j++;
          while (j < n && DIGIT.test(sql[j]!)) j++;
        }
        if ((sql[j] === "e" || sql[j] === "E") && (profile.tsqlLiterals || /^[eE][+-]?[0-9]/.test(sql.slice(j)))) {
          j += sql[j + 1] === "+" || sql[j + 1] === "-" ? 2 : 1;
          while (j < n && DIGIT.test(sql[j]!)) j++;
        }
      }
      // Trailing letters (`1from`, MySQL `1abc`) are lexed as a separate word so a keyword
      // glued to a number is still seen.
      push("number", i, j);
      i = j;
      continue;
    }

    // ---- parameters and punctuation -------------------------------------
    if (ch === ":" && next === ":") {
      push("punct", i, i + 2);
      i += 2;
      continue;
    }
    // On an engine with `E'…'` strings, `:E'` is `:` then an escape string (a JSON_OBJECT key's
    // `:`, an array slice's), never a `:name` placeholder, which a quote can't follow (#703). So is
    // `:b'`, which CockroachDB reads as `:` and a byte string with backslash escapes (#730).
    const prefixedStringAfterColon =
      profile.escapeStrings && next !== undefined && /[eEbB]/.test(next) && sql[i + 2] === "'";
    if (ch === ":" && next !== undefined && WORD_START.test(next) && !prefixedStringAfterColon) {
      let j = i + 1;
      while (j < n && isWordChar(sql[j]!)) j++;
      push("parameter", i, j);
      i = j;
      continue;
    }
    if (ch === "@" && profile.atVariables) {
      let j = i + 1;
      if (sql[j] === "@") j++;
      if (j < n && WORD_START.test(sql[j]!)) {
        while (j < n && isWordChar(sql[j]!)) j++;
        push("parameter", i, j);
        i = j;
        continue;
      }
    }

    push("punct", i, i + 1);
    i++;
  }

  // An executable comment whose `*\/` never came: its body was lexed as code, but the
  // comment itself runs off the end, so flag the opener like any other unclosed comment.
  if (executableOpener !== -1) tokens[executableOpener]!.unterminated = true;

  return tokens;
}

/**
 * The lexer profiles under which a dialect's SQL may be read as Postgres, for the checks that
 * refuse what only that reading can hold (#703): the dialect's own profile when it is on the
 * Postgres lexer (postgres, cockroachdb); for a dialect that is no built-in engine, or none,
 * `POSTGRES_LEXER`, plus a copy with backslash escapes when the dialect sets `backslashEscapes`,
 * since its server may read strings either way; none for any other built-in engine.
 */
export function postgresReadingProfiles(
  dialect?: Pick<DialectSpec, "id" | "backslashEscapes">,
): SqlLexerProfile[] {
  const known = dialect === undefined ? undefined : lexerProfileFor(dialect);
  if (known !== undefined) return known.id === "postgres" ? [known] : [];
  return dialect?.backslashEscapes === true
    ? [POSTGRES_LEXER, { ...POSTGRES_LEXER, backslashEscapes: true }]
    : [POSTGRES_LEXER];
}

/**
 * A Postgres `E'…'` string continued on a later line: the string, then a gap that contains a
 * newline and holds only whitespace and comments, then a bare `'…'` string. Postgres joins the
 * two and keeps the escape mode, so it reads the second one with backslash escapes, which this
 * lexer doesn't: where `\'` ends one reading's string, the other's goes on. AskDB doesn't model
 * the continuation. The read-only check and the tenant check refuse it at this boundary, where
 * both readings still agree (#703, ADR 0012). Postgres allows only whitespace and `--` comments
 * in the gap; a `/* … *\/` comment there is refused too. Returns the `E'…'` token; callers
 * report its position, not its text, which may hold a value from the question.
 */
export function findEscapeStringContinuation(sql: string, tokens: readonly SqlToken[]): SqlToken | undefined {
  return tokens.find((t, i) => t.kind === "string" && /^[eE]'/.test(t.text) && continuedOnLaterLine(sql, tokens, i));
}

/**
 * A CockroachDB byte string, `b'…'` with a lower-case `b`, that holds a backslash or is continued
 * on a later line. CockroachDB reads it with backslash escapes, and keeps them across the
 * continuation. This lexer reads it under the Postgres profile without them, as Postgres reads a
 * bit string, so where `\'` ends one reading's string the other's goes on. AskDB doesn't model the
 * difference. The checks refuse the string at this boundary, where both readings still agree
 * (#730, ADR 0012). What's lost: a byte string with escapes on CockroachDB, which a hex string
 * cast to bytes (`'\x00'::bytea`) can write instead, and a continued lower-case bit string on Postgres, where a backslash in a bit
 * string is an error. `B'…'` is a bit string on both engines and passes. Returns the `b'…'` token;
 * callers report its position, not its text, which may hold a value from the question.
 */
export function findEscapedByteString(sql: string, tokens: readonly SqlToken[]): SqlToken | undefined {
  return tokens.find(
    (t, i) => t.kind === "string" && t.text.startsWith("b'") && (t.text.includes("\\") || continuedOnLaterLine(sql, tokens, i)),
  );
}

/**
 * Whether the string at `tokens[i]` is continued on a later line: a gap that contains a newline
 * and holds only whitespace and comments, then a bare `'…'` string. Postgres and CockroachDB join
 * the two. They allow only whitespace and `--` comments (CockroachDB only whitespace) in the gap;
 * a `/* … *\/` comment counts too, so the callers fail closed.
 */
function continuedOnLaterLine(sql: string, tokens: readonly SqlToken[], i: number): boolean {
  let j = i + 1;
  while (tokens[j]?.kind === "comment") j++;
  const next = tokens[j];
  return next?.kind === "string" && next.text.startsWith("'") && /[\n\r]/.test(sql.slice(tokens[i]!.end, next.start));
}

/**
 * A Postgres Unicode-escaped identifier, as `U&"…"` (either case) with no space between the
 * parts: the form Postgres's scanner reads as one identifier. With a space, `U& "x"` is the
 * `&` operator, and `U&'…'` is a string, which names nothing. Returns the name as written.
 *
 * The `U` can also arrive inside a `:U` parameter token: in an array slice such as
 * `[1:U&"…"]`, Postgres reads the `:` as the slice separator and the rest as the name.
 *
 * Only Postgres-family engines read this form. AskDB doesn't decode it: the read-only check
 * and the tenant check both refuse it instead (#692, #704, ADR 0012).
 */
export function findUnicodeEscapedIdentifier(tokens: readonly SqlToken[]): string | undefined {
  for (let i = 0; i + 2 < tokens.length; i++) {
    const u = tokens[i]!;
    const amp = tokens[i + 1]!;
    const name = tokens[i + 2]!;
    if (
      ((u.kind === "word" && u.lower === "u") || (u.kind === "parameter" && u.lower === ":u")) &&
      amp.kind === "punct" &&
      amp.text === "&" &&
      amp.start === u.end &&
      name.kind === "quoted_identifier" &&
      name.start === amp.end
    ) {
      return `${u.text.slice(-1)}&${name.text}`;
    }
  }
  return undefined;
}

/** The forms only a Postgres reading can hold, as {@link findPostgresOnlyForms} finds them. */
export type PostgresOnlyForms = {
  /** The first `U&"…"` name, as written ({@link findUnicodeEscapedIdentifier}). */
  unicodeEscapedIdentifier: string | undefined;
  /** The `E'…'` token of the first continued escape string ({@link findEscapeStringContinuation}). */
  escapeStringContinuation: SqlToken | undefined;
  /** The first `b'…'` byte string CockroachDB reads differently ({@link findEscapedByteString}). */
  escapedByteString: SqlToken | undefined;
};

/**
 * The forms only a Postgres reading of `sql` can hold, under each reading
 * {@link postgresReadingProfiles} gives for `dialect`: a `U&"…"` name, an `E'…'` string continued
 * on a later line, and a `b'…'` byte string that CockroachDB reads with backslash escapes. The
 * checks match names as written and don't model the escapes, so the tenant check and the
 * sensitive check refuse all three through this one function (#703, #704, #707, #730, ADR 0012).
 * The byte string is found under `postgres` too, since a host may point the `postgres` dialect at
 * CockroachDB, which is wire-compatible. Each field holds the first match across
 * the readings; all are `undefined` when the SQL can't be read as Postgres.
 */
export function findPostgresOnlyForms(
  sql: string,
  dialect?: Pick<DialectSpec, "id" | "backslashEscapes">,
): PostgresOnlyForms {
  const forms: PostgresOnlyForms = {
    unicodeEscapedIdentifier: undefined,
    escapeStringContinuation: undefined,
    escapedByteString: undefined,
  };
  for (const profile of postgresReadingProfiles(dialect)) {
    const tokens = lexSql(sql, profile);
    forms.unicodeEscapedIdentifier ??= findUnicodeEscapedIdentifier(tokens);
    forms.escapeStringContinuation ??= findEscapeStringContinuation(sql, tokens);
    forms.escapedByteString ??= findEscapedByteString(sql, tokens);
  }
  return forms;
}

/** True when any token ran off the end of the input. */
export function hasUnterminatedToken(tokens: readonly SqlToken[]): boolean {
  return tokens.some((t) => t.unterminated === true);
}
