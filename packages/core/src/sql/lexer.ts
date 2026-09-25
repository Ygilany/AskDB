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
  /** The closing delimiter was never found; the token runs to the end of the input. */
  unterminated?: true;
};

const WORD_START = /[A-Za-z_\u0080-￿]/;
const WORD_CHAR = /[A-Za-z0-9_$\u0080-￿]/;
const DIGIT = /[0-9]/;
const HEX = /[0-9A-Fa-f]/;
const DOLLAR_TAG = /^\$([A-Za-z_\u0080-￿][A-Za-z0-9_\u0080-￿]*)?\$/;

/** Split `sql` into tokens under `profile`. Whitespace is dropped; comments are kept. */
export function lexSql(sql: string, profile: SqlLexerProfile): SqlToken[] {
  const tokens: SqlToken[] = [];
  const n = sql.length;
  let i = 0;
  /** Inside a MySQL `/*! … *\/` executable comment. */
  let inExecutableComment = false;

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

    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    // ---- comments -------------------------------------------------------
    if (ch === "-" && next === "-") {
      const after = sql[i + 2];
      const isComment =
        !profile.dashCommentNeedsSpace || after === undefined || /[\s\x00-\x1f]/.test(after);
      if (isComment) {
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
    if (ch === "*" && next === "/" && inExecutableComment) {
      push("comment", i, i + 2);
      inExecutableComment = false;
      i += 2;
      continue;
    }
    if (ch === "/" && next === "*") {
      if (profile.executableComments && !inExecutableComment) {
        const exec = /^\/\*M?!\d*/.exec(sql.slice(i));
        if (exec) {
          push("comment", i, i + exec[0].length);
          inExecutableComment = true;
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
        while (j < n && WORD_CHAR.test(sql[j]!) && sql[j] !== "$") j++;
        push("parameter", i, j);
        i = j;
        continue;
      }
    }

    // ---- words (and prefixed string literals) ---------------------------
    if (WORD_START.test(ch) || (ch === "#" && profile.hashIdentifiers && next !== undefined && (next === "#" || WORD_START.test(next)))) {
      let j = i + 1;
      while (j < n && (WORD_CHAR.test(sql[j]!) || (profile.hashIdentifiers && sql[j] === "#"))) j++;
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
      if (ch === "0" && (next === "x" || next === "X") && HEX.test(sql[i + 2] ?? "")) {
        j = i + 2;
        while (j < n && HEX.test(sql[j]!)) j++;
      } else {
        while (j < n && DIGIT.test(sql[j]!)) j++;
        if (sql[j] === "." && sql[j + 1] !== ".") {
          j++;
          while (j < n && DIGIT.test(sql[j]!)) j++;
        }
        if ((sql[j] === "e" || sql[j] === "E") && /^[eE][+-]?[0-9]/.test(sql.slice(j))) {
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
    if (ch === ":" && next !== undefined && WORD_START.test(next)) {
      let j = i + 1;
      while (j < n && WORD_CHAR.test(sql[j]!)) j++;
      push("parameter", i, j);
      i = j;
      continue;
    }
    if (ch === "@" && profile.atVariables) {
      let j = i + 1;
      if (sql[j] === "@") j++;
      if (j < n && WORD_START.test(sql[j]!)) {
        while (j < n && WORD_CHAR.test(sql[j]!)) j++;
        push("parameter", i, j);
        i = j;
        continue;
      }
    }

    push("punct", i, i + 1);
    i++;
  }

  return tokens;
}

/** True when any token ran off the end of the input. */
export function hasUnterminatedToken(tokens: readonly SqlToken[]): boolean {
  return tokens.some((t) => t.unterminated === true);
}
