import type { DialectSpec } from "./dialect-spec.js";
import { lexerProfileFor, type SqlLexerProfileId } from "./lexer.js";
import { forbiddenKeywordsFor } from "./validate.js";

/** How an engine family quotes an identifier, and whether it folds unquoted names to lowercase. */
type Quoting = { open: string; close: string; foldsToLowercase: boolean };

/** Keyed by the lexer's engine family, so a dialect is quoted the way its SQL is lexed. */
const QUOTING: Record<Exclude<SqlLexerProfileId, "generic">, Quoting> = {
  postgres: { open: '"', close: '"', foldsToLowercase: true },
  mysql: { open: "`", close: "`", foldsToLowercase: false },
  // Brackets, not double quotes: double quotes are a string under `SET QUOTED_IDENTIFIER OFF` (sqlcmd's default).
  sqlserver: { open: "[", close: "]", foldsToLowercase: false },
  sqlite: { open: '"', close: '"', foldsToLowercase: false },
};

/** A name every engine tokenizes as one identifier, unless it is a reserved word. */
const PLAIN_IDENTIFIER = /^[\p{L}_][\p{L}\p{Nd}_$]*$/u;

type QuotedDialect = Pick<DialectSpec, "id" | "identifierQuote" | "reservedWords" | "extraForbiddenKeywords">;

/** An id that is no built-in engine family quotes with `identifierQuote`. */
function quotingFor(dialect: QuotedDialect): Quoting {
  const family = lexerProfileFor(dialect)?.id;
  return family && family !== "generic"
    ? QUOTING[family]
    : { open: dialect.identifierQuote, close: dialect.identifierQuote, foldsToLowercase: false };
}

function quote(quoting: Quoting, name: string): string {
  return `${quoting.open}${name.split(quoting.close).join(quoting.close + quoting.close)}${quoting.close}`;
}

/**
 * How the NL→SQL prompt lists one identifier part (a schema, table or column name) for a
 * dialect: quoted when it is one of the spec's `reservedWords` or a word `validateSelectSql`
 * rejects unquoted, isn't a plain identifier, or
 * has capitals on an engine that folds unquoted names to lowercase (`billing."order"` and
 * `public."Post"` on Postgres, ``billing.`order` `` on MySQL, `billing.[order]` on SQL Server),
 * bare otherwise. Pass it as `quoteIdentifier` to `formatSchemaV2ForNlToSql` or
 * `synthesizeRetrievedDdl`; `ask()` does this itself.
 */
export function promptIdentifierQuoter(
  dialect: Pick<DialectSpec, "id" | "identifierQuote" | "reservedWords" | "extraForbiddenKeywords">,
): (name: string) => string {
  const quoting = quotingFor(dialect);
  // The engine's reserved words, and the words AskDB's validator rejects unquoted (`copy`, `merge`).
  const reserved = new Set([
    ...(dialect.reservedWords ?? []).map((word) => word.toLowerCase()),
    ...forbiddenKeywordsFor(dialect),
  ]);
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
