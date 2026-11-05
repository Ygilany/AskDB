/**
 * Where a T-SQL batch starts a second statement without a `;`.
 *
 * SQL Server needs no separator between statements: `SELECT 1 SELECT 2` is two
 * statements, and Studio's Execute runs the validated SQL inside a batch. This check
 * finds the second statement in SQL that is otherwise a single SELECT. Only the top
 * level (outside every bracket) is checked: a second statement inside brackets is a
 * syntax error, and SQL Server runs nothing from a batch that does not compile.
 *
 * Verbs that start a statement (`DECLARE`, `WHILE`, `EXEC`, …) are the keyword
 * denylist's job (`SQLSERVER_DIALECT.extraForbiddenKeywords`). This module covers the
 * statements no verb announces:
 *
 * - a top-level `SELECT` that follows no set operator and is not the main query
 *   after a leading `WITH` list;
 * - a top-level `(SELECT …` right after a complete expression, such as
 *   `SELECT 1 (SELECT 2)`. After a keyword, an operator, a comma or a function name
 *   the bracket opens a subquery instead;
 * - a `name:` label.
 *
 * It also rejects code SQL Server may split into tokens differently from the lexer
 * ({@link findAmbiguousTsqlText}): rather than copy every corner of SQL Server's
 * tokenizer, the check accepts plain code only.
 */
import type { SqlToken } from "./lexer.js";
import { SQLSERVER_RESERVED_WORDS } from "./reserved-words.js";

/** The token where a second statement starts. */
export type TsqlStatementBoundary = {
  token: SqlToken;
  /**
   * `select`: a top-level SELECT that continues nothing. `query`: a top-level
   * `(SELECT …` after a complete expression. `label`: a `name:` label.
   */
  kind: "select" | "query" | "label";
};

/**
 * Reserved words after which an expression or a subquery follows, so a `(SELECT …`
 * after one of them is a subquery. Each is reserved in T-SQL, so none is an alias.
 */
const EXPRESSION_KEYWORDS = new Set([
  "select", "distinct", "all", "any", "some", "top", "percent",
  "from", "join", "where", "on", "having", "by",
  "and", "or", "not", "in", "exists", "like", "between", "escape",
  "case", "when", "then", "else",
  "union", "except", "intersect",
]);

/** Reserved words that are also function names, so `name((SELECT …))` is a call. */
const RESERVED_FUNCTIONS = new Set([
  "coalesce", "nullif", "convert", "try_convert", "left", "right",
  "contains", "containstable", "freetext", "freetexttable", "openxml", "tsequal",
]);

/**
 * Punctuation an expression may follow: `(`, a comma, an operator, and `.` or `::`
 * before a qualified function name.
 */
const EXPRESSION_PUNCTUATION = new Set(["(", ",", "=", "<", ">", "+", "-", "*", "/", "%", "&", "|", "^", "~", ".", "::"]);

const RESERVED = new Set(SQLSERVER_RESERVED_WORDS);

/**
 * A character allowed in T-SQL code outside strings and quoted names: printable ASCII
 * except `\`, tab, line feed, carriage return, and Unicode letters, combining marks
 * and decimal digits.
 */
const PLAIN_CODE = /[\t\n\r\x20-\x5b\x5d-\x7e\p{L}\p{M}\p{Nd}]/u;
const MONEY_SIGN = /^\p{Sc}$/u;

/**
 * Code SQL Server may split into tokens differently from the lexer, described for an
 * error message, or `undefined`. Text inside strings and quoted identifiers is not
 * checked; `tokens` holds no comments. Fails closed on:
 *
 * - a character outside {@link PLAIN_CODE}: Unicode whitespace and format characters
 *   (U+00A0, U+200B, U+FEFF), symbols, currency signs other than `$`, `\` (a money
 *   sign to SQL Server) and ASCII control characters;
 * - a money sign with no digits after it (`$ .5` is one money literal to SQL Server);
 * - a number written directly against a word or variable (`1ESELECT`, `0xSELECT`).
 *
 * Model-written SQL contains none of these.
 */
export function findAmbiguousTsqlText(sql: string, tokens: readonly SqlToken[]): string | undefined {
  let from = 0;
  const scanTo = (end: number): string | undefined => {
    for (const ch of sql.slice(from, end)) {
      if (PLAIN_CODE.test(ch)) continue;
      if (ch === "\\") return "the character '\\'";
      return `the character U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`;
    }
    return undefined;
  };
  for (const [i, t] of tokens.entries()) {
    if (t.kind === "string" || t.kind === "quoted_identifier") {
      const found = scanTo(t.start);
      if (found) return found;
      from = t.end;
      continue;
    }
    if (t.kind !== "number") continue;
    if (MONEY_SIGN.test(t.text)) return `the money sign '${t.text}'`;
    const next = tokens[i + 1];
    if (next?.start === t.end && (next.kind === "word" || next.kind === "parameter")) {
      return `'${t.text}${next.text}', a number written against a word`;
    }
  }
  return scanTo(sql.length);
}
const SET_OPERATORS = new Set(["union", "except", "intersect"]);

/**
 * The first place `tokens` starts a second T-SQL statement, or `undefined`.
 * `tokens` holds no comments and no trailing `;`.
 */
export function findTsqlStatementBoundary(tokens: readonly SqlToken[]): TsqlStatementBoundary | undefined {
  /** Index of each `)` mapped to the index of the `(` it closes. */
  const opener = new Map<number, number>();
  /** A top-level `ORDER BY` came earlier, so a later `OFFSET` is the keyword. */
  let orderBy = false;

  /** `tokens[i]` is `(` and a `SELECT` follows it, after any further `(`. */
  const opensQuery = (i: number): boolean => {
    let j = i;
    while (isPunct(tokens[j], "(")) j++;
    return isWord(tokens[j], "select");
  };

  /**
   * The word at `j` is a keyword an expression follows. Keywords SQL Server does not
   * reserve count only in their clause; anywhere else they are aliases
   * (`SELECT 1 offset (SELECT 2)` is two statements).
   */
  const introducesExpression = (j: number): boolean => {
    const word = tokens[j]!.lower;
    if (EXPRESSION_KEYWORDS.has(word)) return true;
    const prev = tokens[j - 1];
    switch (word) {
      case "offset":
        // After a sort item, not as one (`ORDER BY offset` sorts by a column).
        return orderBy && !isWord(prev, "by") && !isPunct(prev, ",");
      case "next":
      case "first":
        return isWord(prev, "fetch");
      case "ties":
        return isWord(prev, "with");
      case "apply":
        return isWord(prev, "cross") || isWord(prev, "outer");
      case "zone":
        return isWord(prev, "time") && isWord(tokens[j - 2], "at");
      default:
        return false;
    }
  };

  /**
   * An expression may start right after `tokens[j]`, so a `(SELECT …` there is a
   * subquery. Fails closed: anything not listed (a value, a name, `}`, an unknown
   * keyword) ends the statement, and a `(SELECT …` after it starts a second one.
   */
  const expressionMayFollow = (j: number): boolean => {
    const t = tokens[j];
    if (!t) return true;
    switch (t.kind) {
      case "number":
      case "string":
      case "parameter":
        // `TOP 5 (SELECT …)`: the count, then the first select-list item.
        return isWord(tokens[j - 1], "top");
      case "word":
        return introducesExpression(j);
      case "punct": {
        if (t.text !== ")") return EXPRESSION_PUNCTUATION.has(t.text);
        const at = opener.get(j);
        // `TOP (5) (SELECT …)`.
        return at !== undefined && isWord(tokens[at - 1], "top");
      }
      default:
        return false;
    }
  };

  /**
   * `name((SELECT …))` where `name` is a function: SQL Server reads an unquoted `name(`
   * as a call whenever `name` is not an alias, that is, when an expression may start
   * before it. A quoted name is a call only when qualified (`[dbo].[fn](`); alone,
   * `[name]` is a column.
   */
  const opensCallArgument = (i: number): boolean => {
    if (!isPunct(tokens[i + 1], "(")) return false;
    const name = tokens[i - 1];
    const callable =
      (name?.kind === "quoted_identifier" && isPunct(tokens[i - 2], ".")) ||
      (name?.kind === "word" && (!RESERVED.has(name.lower) || RESERVED_FUNCTIONS.has(name.lower)));
    return callable && expressionMayFollow(i - 2);
  };

  const open: number[] = [];
  let headSeen = false;
  /** After a leading `WITH`, the main query that follows the CTE list is still to come. */
  let mainPending = false;

  for (const [i, t] of tokens.entries()) {
    const topLevel = open.length === 0;
    if (isPunct(t, "(")) {
      if (topLevel && opensQuery(i)) {
        const prev = tokens[i - 1];
        if (mainPending && (isWord(prev, "as") || isWord(prev, "materialized"))) {
          // A CTE body.
        } else if (mainPending && isPunct(prev, ")")) {
          mainPending = false;
        } else if (!expressionMayFollow(i - 1) && !opensCallArgument(i)) {
          return { token: t, kind: "query" };
        }
      }
      open.push(i);
      continue;
    }
    if (isPunct(t, ")")) {
      const at = open.pop();
      if (at !== undefined) opener.set(i, at);
      continue;
    }
    if (!headSeen) {
      headSeen = true;
      mainPending = isWord(t, "with");
      continue;
    }
    if (!topLevel) continue;
    if (startsLabel(t, tokens[i + 1])) return { token: t, kind: "label" };
    if (isWord(t, "by") && isWord(tokens[i - 1], "order")) orderBy = true;
    if (isWord(t, "select")) {
      if (mainPending && isPunct(tokens[i - 1], ")")) {
        mainPending = false;
      } else if (!followsSetOperator(tokens, i)) {
        return { token: t, kind: "select" };
      }
    }
  }
  return undefined;
}

/** `UNION [ALL | DISTINCT]`, `EXCEPT` or `INTERSECT` right before `tokens[i]`. */
function followsSetOperator(tokens: readonly SqlToken[], i: number): boolean {
  let prev = tokens[i - 1];
  if (isWord(prev, "all") || isWord(prev, "distinct")) prev = tokens[i - 2];
  return prev?.kind === "word" && SET_OPERATORS.has(prev.lower);
}

/**
 * `name:` with no space before the colon, which T-SQL reads as a label (`name :` and
 * `[name]:` are syntax errors). The lexer reads `l:SELECT` as `l` and a `:SELECT`
 * parameter; `::` is one token and never a label.
 */
function startsLabel(t: SqlToken, next: SqlToken | undefined): boolean {
  if (t.kind !== "word" || next?.start !== t.end) return false;
  return isPunct(next, ":") || (next.kind === "parameter" && next.text.startsWith(":"));
}

function isPunct(t: SqlToken | undefined, text: string): boolean {
  return t?.kind === "punct" && t.text === text;
}

function isWord(t: SqlToken | undefined, lower: string): boolean {
  return t?.kind === "word" && t.lower === lower;
}
