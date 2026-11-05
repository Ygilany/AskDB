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

const RESERVED = new Set(SQLSERVER_RESERVED_WORDS);
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
        return orderBy;
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

  /** `tokens[j]` completes an expression, so a `(` after it cannot continue the statement. */
  const endsExpression = (j: number): boolean => {
    const t = tokens[j];
    if (!t) return false;
    switch (t.kind) {
      case "number":
      case "string":
      case "parameter":
        // `TOP 5 (SELECT …)`: the count, then the first select-list item.
        return !isWord(tokens[j - 1], "top");
      case "quoted_identifier":
        return true;
      case "word":
        return !introducesExpression(j);
      case "punct": {
        if (t.text !== ")") return false;
        const at = opener.get(j);
        // `TOP (5) (SELECT …)`.
        return at === undefined || !isWord(tokens[at - 1], "top");
      }
      default:
        return false;
    }
  };

  /**
   * `name((SELECT …))` where `name` is a function: SQL Server reads `name(` as a call
   * whenever `name` is not an alias, that is, when nothing complete comes before it.
   */
  const opensCallArgument = (i: number): boolean => {
    if (!isPunct(tokens[i + 1], "(")) return false;
    const name = tokens[i - 1];
    const callable =
      name?.kind === "quoted_identifier" ||
      (name?.kind === "word" && (!RESERVED.has(name.lower) || RESERVED_FUNCTIONS.has(name.lower)));
    return callable && !endsExpression(i - 2);
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
        } else if (endsExpression(i - 1) && !opensCallArgument(i)) {
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
