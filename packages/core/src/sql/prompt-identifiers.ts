import type { DialectSpec } from "./dialect-spec.js";
import {
  MYSQL_RESERVED_WORDS,
  POSTGRES_RESERVED_WORDS,
  SQLITE_KEYWORDS,
  SQLSERVER_RESERVED_WORDS,
} from "./reserved-words.js";

type Quoting = { open: string; close: string; reserved: ReadonlySet<string> };

const POSTGRES_QUOTING: Quoting = { open: '"', close: '"', reserved: new Set(POSTGRES_RESERVED_WORDS) };
const MYSQL_QUOTING: Quoting = { open: "`", close: "`", reserved: new Set(MYSQL_RESERVED_WORDS) };
// Brackets, not double quotes: double quotes are a string under `SET QUOTED_IDENTIFIER OFF` (sqlcmd's default).
const SQLSERVER_QUOTING: Quoting = { open: "[", close: "]", reserved: new Set(SQLSERVER_RESERVED_WORDS) };
const SQLITE_QUOTING: Quoting = { open: '"', close: '"', reserved: new Set(SQLITE_KEYWORDS) };

/** A name every engine reads unquoted, unless it is a reserved word. */
const PLAIN_IDENTIFIER = /^[\p{L}_][\p{L}\p{N}_$]*$/u;

/**
 * Quoting follows `id`, as the lexer does. An id that is not a built-in engine family
 * quotes with `identifierQuote` and knows no reserved words.
 */
function quotingFor(dialect: Pick<DialectSpec, "id" | "identifierQuote">): Quoting {
  switch (dialect.id as string) {
    case "postgres":
    case "cockroachdb":
      return POSTGRES_QUOTING;
    case "mysql":
    case "mariadb":
      return MYSQL_QUOTING;
    case "sqlserver":
      return SQLSERVER_QUOTING;
    case "sqlite":
      return SQLITE_QUOTING;
    default:
      return { open: dialect.identifierQuote, close: dialect.identifierQuote, reserved: new Set() };
  }
}

function quote(quoting: Quoting, name: string): string {
  return `${quoting.open}${name.split(quoting.close).join(quoting.close + quoting.close)}${quoting.close}`;
}

/**
 * How the NL→SQL prompt lists one identifier part (a schema, table or column name) for a
 * dialect: quoted when it is one of the engine's reserved words or not a plain identifier
 * (`billing."order"` on Postgres, ``billing.`order` `` on MySQL, `billing.[order]` on
 * SQL Server), bare otherwise. Pass it as `quoteIdentifier` to `formatSchemaV2ForNlToSql`
 * or `synthesizeRetrievedDdl`; `ask()` does this itself.
 */
export function promptIdentifierQuoter(
  dialect: Pick<DialectSpec, "id" | "identifierQuote">,
): (name: string) => string {
  const quoting = quotingFor(dialect);
  return (name) =>
    PLAIN_IDENTIFIER.test(name) && !quoting.reserved.has(name.toLowerCase()) ? name : quote(quoting, name);
}

/** The prompt rule for qualified names, with the dialect's quotes in its example. */
export function qualifiedNameQuotingRule(dialect: Pick<DialectSpec, "id" | "identifierQuote">): string {
  const quoting = quotingFor(dialect);
  const parts = `${quote(quoting, "schema")}.${quote(quoting, "table")}`;
  const whole = quote(quoting, "schema.table");
  return `- Quote each part of a qualified name separately: ${inlineCode(parts)}, never ${inlineCode(whole)}.`;
}

/** Markdown inline code that may itself contain backticks. */
function inlineCode(text: string): string {
  return text.includes("`") ? `\`\` ${text} \`\`` : `\`${text}\``;
}
