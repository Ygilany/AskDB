import { AskDbError } from "../errors.js";
import type { AnyNormalizedSchema } from "../schema/types.js";

const JOIN_RELATION_HINT =
  /\b(join|joined|joins|inner\s+join|left\s+join|right\s+join|full\s+join|together\s+with|along\s+with|versus|vs\.?|compare|both\s+tables|each\s+other|relationship\s+between|how\s+they\s+relate)\b/i;

/** FROM / JOIN table names in the question (simple identifier; no schema-qualified names in v1). */
const FROM_JOIN_TABLE = /\b(?:from|join)\s+([a-zA-Z_][\w]*)\b/gi;

export function assertNlToSqlInputs(schema: AnyNormalizedSchema, question: string): void {
  if (schema.tables.length === 0) {
    throw new AskDbError(
      "Schema has no tables. Add at least one table to the AskDB schema JSON (see fixtures/schemas/ in this repo).",
    );
  }
  if (!question.trim()) {
    throw new AskDbError("Question is empty. Pass a non-blank natural-language question with -q / --question.");
  }
}

/**
 * Deterministic notes appended to the NL→SQL user prompt when the question and schema look misaligned.
 *
 * The notes name no schema table. The prompt's DDL already lists every table the model may use, and
 * a list here would name tables the DDL leaves out: an untracked one (`tracked: false`), or one that
 * retrieval didn't pick (#677). The question is checked against tracked tables only, the ones the
 * full-schema prompt can show.
 */
export function nlToSqlAmbiguityNotes(question: string, schema: AnyNormalizedSchema): string[] {
  const notes: string[] = [];
  const tracked = schema.tables.filter((t) => (t as { tracked?: boolean }).tracked !== false);
  const tableNames = new Set(tracked.map((t) => t.name.toLowerCase()));

  if (tracked.length === 1 && JOIN_RELATION_HINT.test(question)) {
    notes.push(
      "The schema lists only one table. Do not invent joins to other tables unless their names appear explicitly in the schema excerpt.",
    );
  }

  const seen = new Set<string>();
  for (const m of question.matchAll(FROM_JOIN_TABLE)) {
    const raw = m[1]!;
    const low = raw.toLowerCase();
    if (seen.has(low)) continue;
    seen.add(low);
    if (!tableNames.has(low)) {
      notes.push(`The question mentions table "${raw}" which is not in the schema.`);
    }
  }

  return notes;
}
