import { SensitiveEnrichmentTargetError } from "../errors.js";
import { formatSchemaV2ForNlToSql } from "../schema/v2/format.js";
import type { NormalizedSchemaV2 } from "../schema/v2/normalized.js";
import type { V2Column, V2Table } from "../schema/v2/physical.js";
import type { EnrichmentContext, EnrichmentPromptOptions, EnrichmentTarget } from "./types.js";

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
  options: EnrichmentPromptOptions = {},
): string {
  const omit = options.omitSensitiveIdentifiersFromPrompt === true;
  if (omit && "columnId" in target) {
    const column = findColumn(target.table, target.columnId);
    if (column.sensitive === true || target.table.sensitive === true) {
      throw new SensitiveEnrichmentTargetError();
    }
  }
  const lines: string[] = [];
  lines.push(`Schema: ${ctx.schemaId}`);
  lines.push(tableForPrompt(target.table, ctx.schemaId, omit));

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

/**
 * The target table's physical layer as `ask()`'s prompt lists it (ADR 0026):
 * `formatSchemaV2ForNlToSql` tags sensitive columns, or withholds them under omission, and
 * lists a sensitive table's columns as sensitive, or only its name under omission. The copy
 * carries no describable text.
 */
function tableForPrompt(table: V2Table, schemaId: string, omit: boolean): string {
  const physical: NormalizedSchemaV2 = {
    schemaId,
    warnings: [],
    tables: [
      {
        id: table.id,
        name: table.name,
        schema: table.schema,
        sensitive: table.sensitive === true,
        columns: table.columns.map((column: V2Column) => ({
          id: column.id,
          name: column.name,
          type: column.type,
          nullable: column.nullable,
          primaryKey: column.primaryKey === true,
          sensitive: column.sensitive === true,
        })),
      },
    ],
  };
  return formatSchemaV2ForNlToSql(physical, { omitSensitiveIdentifiersFromPrompt: omit }).ddl;
}

function findColumn(table: V2Table, columnId: string): V2Column {
  const col = table.columns.find((c) => c.id === columnId);
  if (!col) throw new Error(`Column not found: ${columnId} in ${qualifiedName(table)}`);
  return col;
}

function qualifiedName(t: V2Table): string {
  return `${t.schema}.${t.name}`;
}
