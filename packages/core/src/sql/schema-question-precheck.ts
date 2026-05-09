import { AskDbError } from "../errors.js";
import type { AnyNormalizedSchema } from "./prompt.js";

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
 */
export function nlToSqlAmbiguityNotes(question: string, schema: AnyNormalizedSchema): string[] {
  const notes: string[] = [];
  const tableNames = new Set(schema.tables.map((t) => t.name.toLowerCase()));

  if (schema.tables.length === 1 && JOIN_RELATION_HINT.test(question)) {
    const only = schema.tables[0]!.name;
    notes.push(
      `The schema lists only one table (${only}). Do not invent joins to other tables unless their names appear explicitly in the schema excerpt.`,
    );
  }

  const seen = new Set<string>();
  for (const m of question.matchAll(FROM_JOIN_TABLE)) {
    const raw = m[1]!;
    const low = raw.toLowerCase();
    if (seen.has(low)) continue;
    seen.add(low);
    if (!tableNames.has(low)) {
      const known = [...tableNames].sort().join(", ");
      notes.push(
        `The question mentions table "${raw}" which is not in the schema. Known tables: ${known || "(none)"}.`,
      );
    }
  }

  return notes;
}
