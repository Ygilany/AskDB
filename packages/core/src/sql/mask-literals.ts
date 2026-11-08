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
import { lexSql, type SqlToken } from "./lexer.js";
import { tenantStatementReadings, type ReadingDialect } from "./readings.js";

const MASKED: ReadonlySet<SqlToken["kind"]> = new Set(["string", "number", "comment"]);
const LITERAL: ReadonlySet<SqlToken["kind"]> = new Set(["string", "number"]);

type Range = { start: number; end: number; literal: boolean };

export function maskSqlLiterals(sql: string, dialect?: ReadingDialect): string | undefined {
  const readings = tenantStatementReadings(dialect);
  const ranges: Range[] = [];
  for (const profile of readings) {
    for (const token of lexSql(sql, profile)) {
      if (token.unterminated) return undefined;
      if (MASKED.has(token.kind)) {
        ranges.push({ start: token.start, end: token.end, literal: LITERAL.has(token.kind) });
      }
    }
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
    if (current && range.start < current.end) {
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
