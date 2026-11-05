import {
  columnAnnotation,
  listAsStored,
  promptTableName,
  promptTextGate,
  tableAliasNote,
} from "../schema/v2/format.js";
import type { NormalizedSchemaV2 } from "../schema/v2/normalized.js";
import type { RetrievedResult } from "./types.js";

/**
 * Build a focused DDL block for NL→SQL prompts from retrieved chunks.
 *
 * Layout (decided in implementation, per Phase 8 spec's "open choice"):
 *   1. Each table referenced by any retrieved chunk gets a TABLE block with
 *      its full column definitions (so the model has complete column lists).
 *   2. Column-chunk descriptions become inline `-- aliases / values / desc`
 *      annotations on the matching column line.
 *   3. CQL chunks land as a `-- common query language --` block under the
 *      table.
 *   4. Concept and question chunks attach as system-context paragraphs at
 *      the bottom (before the question).
 *
 * Sensitive identifiers retain their `(sensitive)` tagging exactly as
 * `formatSchemaV2ForNlToSql` does. With `omitSensitiveIdentifiersFromPrompt`,
 * schema text is withheld by the same rule, and so is the text of every
 * retrieved chunk that names a sensitive column or is flagged `sensitive`
 * (ADR 0022): core can't vouch for the retriever. A withheld chunk still
 * picks its tables.
 */
export function synthesizeRetrievedDdl(args: {
  schema: NormalizedSchemaV2;
  results: RetrievedResult[];
  /** Mirrors `formatSchemaV2ForNlToSql`'s `omitSensitiveIdentifiersFromPrompt`. */
  omitSensitiveIdentifiersFromPrompt?: boolean;
  /** Mirrors `formatSchemaV2ForNlToSql`'s `unqualifiedNamespace`. */
  unqualifiedNamespace?: string;
  /** Mirrors `formatSchemaV2ForNlToSql`'s `quoteIdentifier`. */
  quoteIdentifier?: (name: string) => string;
}): {
  ddl: string;
  tablesEmitted: number;
  chunksUsed: number;
  /** With omission on: schema texts and chunks withheld because they name a sensitive column or are flagged `sensitive`. */
  mentionDroppedCount: number;
} {
  const { schema, results } = args;
  const omit = args.omitSensitiveIdentifiersFromPrompt === true;
  const quoteIdentifier = args.quoteIdentifier ?? listAsStored;
  const gate = promptTextGate(schema, omit);
  /** Renders a retrieved chunk's text as the prompt shows it, then lets the gate check exactly that. */
  const shown = (p: RetrievedResult["payload"], render: (body: string) => string, into: string[]): void => {
    const text = render(stripHeaderLine(p.text));
    if (gate.allows(text, p.sensitive)) into.push(text);
  };
  const asIs = (body: string) => body;
  const oneLine = (body: string) => body.replace(/\n+/g, " ");
  const joinedLines = (body: string) => body.replace(/\n+/g, "; ");

  const tableIds = new Set<string>();
  const cqlPerTable = new Map<string, string[]>();
  const concepts: string[] = [];
  const questions: string[] = [];
  const relationships: string[] = [];
  const tenantPolicyChunks: string[] = [];

  for (const r of results) {
    const p = r.payload;
    switch (p.type) {
      case "table": {
        const tid = p.refs[0];
        if (tid) tableIds.add(tid);
        break;
      }
      case "column": {
        const tid = p.refs[0];
        if (tid) tableIds.add(tid);
        break;
      }
      case "cql": {
        const tid = p.refs[0];
        if (tid) {
          tableIds.add(tid);
          const list = cqlPerTable.get(tid) ?? [];
          shown(p, asIs, list);
          cqlPerTable.set(tid, list);
        }
        break;
      }
      case "question": {
        shown(p, oneLine, questions);
        if (p.refs[0]) tableIds.add(p.refs[0]);
        break;
      }
      case "concept": {
        shown(p, joinedLines, concepts);
        for (const ref of p.refs) {
          if (ref.startsWith("table:")) {
            const hash = ref.indexOf("#");
            tableIds.add(hash === -1 ? ref : ref.slice(0, hash));
          }
        }
        break;
      }
      case "relationship": {
        shown(p, oneLine, relationships);
        for (const ref of p.refs) {
          if (ref.startsWith("table:") && !ref.includes("#")) tableIds.add(ref);
        }
        break;
      }
      case "tenant-policy": {
        shown(p, joinedLines, tenantPolicyChunks);
        break;
      }
    }
  }

  const lines: string[] = [];
  let tablesEmitted = 0;

  for (const t of schema.tables) {
    if (!tableIds.has(t.id)) continue;
    tablesEmitted++;
    const listedName = promptTableName(t, args.unqualifiedNamespace, quoteIdentifier);
    lines.push(`TABLE ${listedName}${tableAliasNote(t, gate)}`);
    if (!t.sensitive && t.description && gate.allows(t.description)) lines.push(`-- ${t.description}`);

    if (omit && t.sensitive) {
      lines.push(`  (sensitive table — column definitions withheld from model context)`);
      lines.push("");
      continue;
    }

    for (const c of t.columns) {
      if (omit && c.sensitive) continue;
      const flags: string[] = [];
      if (c.primaryKey) flags.push("PK");
      flags.push(c.nullable ? "NULL" : "NOT NULL");
      const sensitiveTag = c.sensitive || t.sensitive ? " (sensitive)" : "";
      let line = `  - ${quoteIdentifier(c.name)} ${c.type} (${flags.join(" ")})${sensitiveTag}`;
      if (!c.sensitive && !t.sensitive) {
        const annotation = columnAnnotation(c, gate);
        if (annotation) line += ` -- ${annotation}`;
      }
      lines.push(line);
    }

    const cqlList = cqlPerTable.get(t.id);
    if (cqlList && cqlList.length > 0 && !t.sensitive) {
      lines.push(`-- common query language --`);
      for (const body of cqlList) {
        for (const cqlLine of body.split("\n")) {
          lines.push(`-- ${cqlLine}`);
        }
      }
    }
    lines.push("");
  }

  if (relationships.length > 0) {
    lines.push("-- relationships --");
    for (const r of relationships) lines.push(`-- ${r}`);
    lines.push("");
  }

  if (concepts.length > 0) {
    lines.push("-- concepts --");
    for (const c of concepts) lines.push(`-- ${c}`);
    lines.push("");
  }

  if (questions.length > 0) {
    lines.push("-- example questions for context --");
    for (const q of questions) lines.push(`-- ${q}`);
    lines.push("");
  }

  if (tenantPolicyChunks.length > 0) {
    lines.push("-- tenant policy context --");
    for (const tp of tenantPolicyChunks) lines.push(`-- ${tp}`);
    lines.push("");
  }

  return {
    ddl: lines.join("\n").trimEnd(),
    tablesEmitted,
    chunksUsed: results.length,
    mentionDroppedCount: gate.withheld,
  };
}

function stripHeaderLine(text: string): string {
  if (text.startsWith("#")) {
    const nl = text.indexOf("\n");
    return nl === -1 ? "" : text.slice(nl + 1).trim();
  }
  return text.trim();
}
