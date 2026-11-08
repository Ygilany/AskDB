/**
 * Replaces every literal in a SQL statement with `?` so the statement can go to a model
 * without the values it holds: strings, numbers and bound tenant values become `?`, and
 * comments are dropped. Names, keywords, operators and parameters stay.
 *
 * It reads the statement every way the tenant check does ({@link tenantStatementReadings}):
 * the dialect's own readings for a built-in engine, and every engine's, with both string
 * settings, for any other id or none. A character that any reading puts inside a literal or a
 * comment is masked, so a reading that disagrees about where a string ends masks more, not less.
 * Returns `undefined`, so the caller sends no SQL at all, when a token never ends or a literal
 * survives a re-read of the masked text.
 */
import type { AskDialect, AskDialectInput } from "../ask.js";
import { getDialectSpec, isBuiltInDialectId, type DialectSpec } from "./dialect-spec.js";
import { lexSql, type SqlToken } from "./lexer.js";
import { tenantStatementReadings, type ReadingDialect } from "./readings.js";

const MASKED: ReadonlySet<SqlToken["kind"]> = new Set(["string", "number", "comment"]);
const LITERAL: ReadonlySet<SqlToken["kind"]> = new Set(["string", "number"]);

type Range = { start: number; end: number; literal: boolean };

/**
 * How `dialect` is read, resolved as `ask()` resolves it: a built-in id to its spec, a spec as
 * itself. An id that isn't built in, or a custom `AskDialect`, has no reading of its own, so
 * every engine's reading applies.
 */
function readingOf(dialect: AskDialectInput | undefined): ReadingDialect | undefined {
  if (dialect === undefined) return undefined;
  if (typeof dialect === "string") return isBuiltInDialectId(dialect) ? getDialectSpec(dialect) : undefined;
  if (typeof (dialect as AskDialect).generate === "function") return undefined;
  return dialect as DialectSpec;
}

export function maskSqlLiterals(sql: string, dialect?: AskDialectInput): string | undefined {
  const readings = tenantStatementReadings(readingOf(dialect));
  const ranges: Range[] = [];
  for (const profile of readings) {
    const tokens = lexSql(sql, profile);
    tokens.forEach((token, i) => {
      if (MASKED.has(token.kind)) {
        ranges.push({ start: token.start, end: token.end, literal: LITERAL.has(token.kind) });
      }
      // A word right after a number is the rest of it on an engine that reads more number
      // forms than the lexer (`1_000`, `0o17`, `0b101`), so it is masked with it.
      const next = tokens[i + 1];
      if (token.kind === "number" && next?.kind === "word" && next.start === token.end) {
        ranges.push({ start: next.start, end: next.end, literal: true });
      }
    });
    if (tokens.some((t) => t.unterminated)) return undefined;
  }
  ranges.sort((a, b) => a.start - b.start || b.end - a.end);
  let out = "";
  let at = 0;
  let current: Range | undefined;
  const flush = () => {
    if (!current) return;
    out += current.literal ? "?" : " ";
    at = current.end;
    current = undefined;
  };
  for (const range of ranges) {
    // Overlapping ranges merge, and so do literals that touch (`0` and `o17` in `0o17`).
    if (current && (range.start < current.end || (range.start === current.end && range.literal && current.literal))) {
      current.end = Math.max(current.end, range.end);
      current.literal ||= range.literal;
      continue;
    }
    flush();
    out += sql.slice(at, range.start);
    current = { ...range };
  }
  flush();
  out += sql.slice(at);

  for (const profile of readings) {
    if (lexSql(out, profile).some((t) => t.unterminated || LITERAL.has(t.kind))) return undefined;
  }
  return out;
}
