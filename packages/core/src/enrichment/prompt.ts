import type { V2Column, V2Table } from "../schema/v2/physical.js";
import type { EnrichmentContext, EnrichmentTarget } from "./types.js";

export const ENRICHMENT_SYSTEM_PROMPT = `You enrich AskDB Schema v2 describable metadata.

Rules:
- Be concise. Descriptions: one sentence, no marketing language.
- Aliases: 2–4 lowercase, comma-separated, the way people *say* the thing
  in plain English. No quotes, no synonyms of synonyms.
- Common query language: 2–4 short bullet lines mapping a colloquial term
  to the SQL filter or aggregation it implies.
- Never invent columns, tables, or relationships not in the schema.
- Never suggest values for sensitive columns (they will be excluded by RAG).
- Reply with 1–3 candidate options separated by exactly the line "---".
  Do not number, prefix, or label the candidates.`;

export function buildEnrichmentUserPrompt(
  target: EnrichmentTarget,
  ctx: EnrichmentContext,
): string {
  const lines: string[] = [];
  lines.push(`Schema: ${ctx.schemaId}`);
  lines.push(`Table: ${qualifiedName(target.table)}`);

  // Always include the column list for context.
  lines.push("Columns:");
  for (const c of target.table.columns) {
    lines.push(`  - ${describeColumn(c)}`);
  }

  if (ctx.neighbors && ctx.neighbors.length > 0) {
    lines.push("");
    lines.push("Related tables (FK neighbors):");
    for (const t of ctx.neighbors) {
      lines.push(`  - ${qualifiedName(t)} (${t.columns.length} columns)`);
    }
  }

  lines.push("");
  lines.push(targetInstruction(target));

  return lines.join("\n");
}

function targetInstruction(target: EnrichmentTarget): string {
  switch (target.kind) {
    case "table-description":
      return `Suggest a one-sentence description of what the \`${target.table.name}\` table holds and what each row represents.`;
    case "table-aliases":
      return `Suggest 2–4 short aliases (comma-separated) people might use to refer to the \`${target.table.name}\` table in plain English.`;
    case "table-primary-entity":
      return `Suggest the primary entity (a single noun) that one row of \`${target.table.name}\` represents.`;
    case "column-description": {
      const col = findColumn(target.table, target.columnId);
      return `Suggest a one-sentence description of the \`${col.name}\` column (type \`${col.type}\`) on \`${target.table.name}\`.`;
    }
    case "column-aliases": {
      const col = findColumn(target.table, target.columnId);
      return `Suggest 2–4 short aliases (comma-separated) people might use for the \`${col.name}\` column on \`${target.table.name}\`.`;
    }
    case "common-query-language":
      return `Suggest 2–4 "common query language" bullet lines for \`${target.table.name}\` that map colloquial business terms to the SQL conditions they imply.`;
  }
}

function describeColumn(c: V2Column): string {
  const parts = [c.name, c.type];
  if (c.primaryKey) parts.push("[pk]");
  if (c.sensitive) parts.push("[sensitive]");
  if (c.nullable) parts.push("[nullable]");
  return parts.join(" ");
}

function findColumn(table: V2Table, columnId: string): V2Column {
  const col = table.columns.find((c) => c.id === columnId);
  if (!col) throw new Error(`Column not found: ${columnId} in ${qualifiedName(table)}`);
  return col;
}

function qualifiedName(t: V2Table): string {
  return `${t.schema}.${t.name}`;
}
