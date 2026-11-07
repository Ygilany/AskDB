import type { NormalizedV2Table } from "./normalized.js";

/**
 * Whether a table can reach the NL→SQL prompt. A table marked `tracked: false` is left out of the
 * prompt's DDL and of RAG indexing (`docs/contracts/schema-v2.md`), so nothing else in the prompt
 * may name it either (ADR 0038).
 */
export function isTrackedTable(table: Pick<NormalizedV2Table, "tracked">): boolean {
  return table.tracked !== false;
}
