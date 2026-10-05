import type { DialectSpec } from "./dialect-spec.js";

/** How an engine family quotes an identifier, and whether it folds unquoted names to lowercase. */
type Quoting = { open: string; close: string; foldsToLowercase: boolean };

const DOUBLE_QUOTES: Quoting = { open: '"', close: '"', foldsToLowercase: false };
const POSTGRES_QUOTING: Quoting = { ...DOUBLE_QUOTES, foldsToLowercase: true };
const MYSQL_QUOTING: Quoting = { open: "`", close: "`", foldsToLowercase: false };
// Brackets, not double quotes: double quotes are a string under `SET QUOTED_IDENTIFIER OFF` (sqlcmd's default).
const SQLSERVER_QUOTING: Quoting = { open: "[", close: "]", foldsToLowercase: false };

/** A name every engine tokenizes as one identifier, unless it is a reserved word. */
const PLAIN_IDENTIFIER = /^[\p{L}_][\p{L}\p{N}_$]*$/u;

type QuotedDialect = Pick<DialectSpec, "id" | "identifierQuote" | "reservedWords">;

/**
 * Quoting follows `id`, as the lexer does. An id that is no built-in engine family quotes
 * with `identifierQuote`.
 */
function quotingFor(dialect: QuotedDialect): Quoting {
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
      return DOUBLE_QUOTES;
    default:
      return { open: dialect.identifierQuote, close: dialect.identifierQuote, foldsToLowercase: false };
  }
}

function quote(quoting: Quoting, name: string): string {
  return `${quoting.open}${name.split(quoting.close).join(quoting.close + quoting.close)}${quoting.close}`;
}

/**
 * How the NL→SQL prompt lists one identifier part (a schema, table or column name) for a
 * dialect: quoted when it is one of the spec's `reservedWords`, isn't a plain identifier, or
 * has capitals on an engine that folds unquoted names to lowercase (`billing."order"` and
 * `public."Post"` on Postgres, ``billing.`order` `` on MySQL, `billing.[order]` on SQL Server),
 * bare otherwise. Pass it as `quoteIdentifier` to `formatSchemaV2ForNlToSql` or
 * `synthesizeRetrievedDdl`; `ask()` does this itself.
 */
export function promptIdentifierQuoter(dialect: QuotedDialect): (name: string) => string {
  const quoting = quotingFor(dialect);
  const reserved = new Set(dialect.reservedWords?.map((word) => word.toLowerCase()));
  return (name) =>
    PLAIN_IDENTIFIER.test(name) &&
    !reserved.has(name.toLowerCase()) &&
    !(quoting.foldsToLowercase && name !== name.toLowerCase())
      ? name
      : quote(quoting, name);
}

/**
 * The prompt rule for qualified names, with the dialect's quotes in its example. It shows only
 * the right form: with `never \`schema.table\`` added, gpt-4o-mini quoted the whole dotted name
 * more often, not less (#451).
 */
export function qualifiedNameQuotingRule(dialect: QuotedDialect): string {
  const quoting = quotingFor(dialect);
  const parts = `${quote(quoting, "schema")}.${quote(quoting, "table")}`;
  return `- When you quote a qualified name, quote each part separately: ${inlineCode(parts)}.`;
}

/** Markdown inline code that may itself contain backticks. */
function inlineCode(text: string): string {
  return text.includes("`") ? `\`\` ${text} \`\`` : `\`${text}\``;
}
