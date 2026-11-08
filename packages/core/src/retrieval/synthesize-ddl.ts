import {
  businessContextLines,
  columnAnnotation,
  conceptRenderer,
  foreignKeyLinesByTable,
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
 * Layout:
 *   1. Each table referenced by any retrieved chunk gets a TABLE block with
 *      its full column definitions (so the model has complete column lists).
 *      Each column line carries the schema's own `-- aliases / values / desc`
 *      annotation, plus `note: …` from a retrieved column chunk's
 *      `Column notes` line, gated with the annotation as one unit.
 *      Then the table's foreign keys to other shown tables, as the
 *      full-schema prompt prints them (#898).
 *   2. CQL chunks land as a `-- common query language --` block under the
 *      table, then `Business context` chunks as a `-- business context --`
 *      block, its parts in body order (#894).
 *   3. Concept, example-question and tenant-policy chunks follow the tables,
 *      each kind as its own `-- … --` block, in that order. A concept the
 *      schema has prints as the full-schema prompt prints it
 *      (`conceptRenderer`); another keeps its chunk text and heading, as a
 *      tenant-policy chunk does (the policy section's name). A relationship
 *      chunk only picks its two tables: their foreign key prints from the
 *      schema (#898).
 *
 * `@askdb/rag` types a `Business context` chunk `table`; its id
 * (`…<table-id>#biz`, `…#biz#bc:<n>` for part n of a long body; the schema v2
 * contract's chunking rules) tells it apart from the table chunk. A sensitive
 * table's CQL and business context, and a sensitive column's note, never
 * show, like the schema's own describable text.
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
  /** The ids of the tables `ddl` shows, in schema order: the prompt's tables under retrieval (#771). */
  tableIds: string[];
  chunksUsed: number;
  /** With omission on: schema texts and chunks withheld because they name a sensitive column or are flagged `sensitive`. */
  mentionDroppedCount: number;
} {
  const { schema, results } = args;
  const omit = args.omitSensitiveIdentifiersFromPrompt === true;
  const quoteIdentifier = args.quoteIdentifier ?? listAsStored;
  const gate = promptTextGate(schema, omit);
  /**
   * Renders a retrieved chunk's text as the prompt shows it, then lets the gate check exactly that.
   * `keepHeading` keeps the chunk's `# heading` line, without its `#`.
   */
  const shown = (
    p: RetrievedResult["payload"],
    render: (body: string) => string,
    into: string[],
    keepHeading = false,
  ): void => {
    const text = render(keepHeading ? headingKept(p.text) : stripHeaderLine(p.text));
    if (gate.allows(text, p.sensitive)) into.push(text);
  };
  const asIs = (body: string) => body;
  const oneLine = (body: string) => body.replace(/\n+/g, " ");
  const joinedLines = (body: string) => body.replace(/\n+/g, "; ");

  const tableIds = new Set<string>();
  const cqlPerTable = new Map<string, string[]>();
  const businessPerTable = new Map<string, { part: number; text: string }[]>();
  const notePerColumn = new Map<string, { note: string; sensitive: boolean }>();
  const concepts: string[] = [];
  const questions: string[] = [];
  const tenantPolicyChunks: string[] = [];
  const renderConcept = conceptRenderer(schema, { unqualifiedNamespace: args.unqualifiedNamespace, quoteIdentifier });

  for (const r of results) {
    const p = r.payload;
    switch (p.type) {
      case "table": {
        const tid = p.refs[0];
        if (!tid) break;
        tableIds.add(tid);
        const part = businessContextPart(p.id, tid);
        if (part !== undefined) {
          const kept: string[] = [];
          shown(p, asIs, kept);
          const list = businessPerTable.get(tid) ?? [];
          for (const text of kept) list.push({ part, text });
          businessPerTable.set(tid, list);
        }
        break;
      }
      case "column": {
        const tid = p.refs[0];
        if (tid) tableIds.add(tid);
        const cid = p.refs[1];
        const note = columnNote(p.text);
        // Gated with the column's annotation, where it renders (`columnAnnotation`).
        if (cid && note) notePerColumn.set(cid, { note, sensitive: p.sensitive });
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
        const concept = schema.concepts?.find((c) => c.id === p.refs[0]);
        if (concept) {
          const rendered = renderConcept(concept);
          if (rendered && gate.allows(rendered.text, p.sensitive || rendered.linksSensitive)) concepts.push(rendered.body);
        } else {
          shown(p, joinedLines, concepts, true);
        }
        for (const ref of p.refs) {
          if (ref.startsWith("table:")) {
            const hash = ref.indexOf("#");
            tableIds.add(hash === -1 ? ref : ref.slice(0, hash));
          }
        }
        break;
      }
      case "relationship": {
        for (const ref of p.refs) {
          if (ref.startsWith("table:") && !ref.includes("#")) tableIds.add(ref);
        }
        break;
      }
      case "tenant-policy": {
        shown(p, joinedLines, tenantPolicyChunks, true);
        break;
      }
    }
  }

  const lines: string[] = [];
  const emittedIds: string[] = [];
  const foreignKeys = foreignKeyLinesByTable(schema, {
    omit,
    shown: (tableId) => tableIds.has(tableId),
    unqualifiedNamespace: args.unqualifiedNamespace,
    quoteIdentifier,
  });

  for (const t of schema.tables) {
    if (!tableIds.has(t.id)) continue;
    emittedIds.push(t.id);
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
        const retrieved = notePerColumn.get(c.id);
        // A description that itself starts `Note: ` is the chunk's last line when the column has no note.
        const note = retrieved && c.description?.trim() !== `Note: ${retrieved.note}` ? retrieved : undefined;
        const annotation = columnAnnotation(c, gate, note);
        if (annotation) line += ` -- ${annotation}`;
      }
      lines.push(line);
    }

    lines.push(...(foreignKeys.get(t.id) ?? []));

    const cqlList = cqlPerTable.get(t.id);
    if (cqlList && cqlList.length > 0 && !t.sensitive) {
      lines.push(`-- common query language --`);
      for (const body of cqlList) {
        for (const cqlLine of body.split("\n")) {
          lines.push(`-- ${cqlLine}`);
        }
      }
    }

    const businessList = businessPerTable.get(t.id);
    if (businessList && !t.sensitive) {
      lines.push(...businessContextLines([...businessList].sort((a, b) => a.part - b.part).map(({ text }) => text)));
    }
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
    tablesEmitted: emittedIds.length,
    tableIds: emittedIds,
    chunksUsed: results.length,
    mentionDroppedCount: gate.withheld,
  };
}

/**
 * For a `table` chunk built from `tableId`'s `Business context` section, the part's position in
 * the body (0 when the body wasn't split); `undefined` for any other chunk, the table chunk included.
 */
function businessContextPart(chunkId: string, tableId: string): number | undefined {
  const marker = `${tableId}#biz`;
  if (chunkId.endsWith(marker)) return 0;
  const split = /#bc:(\d+)$/.exec(chunkId);
  if (split && chunkId.slice(0, split.index).endsWith(marker)) return Number(split[1]);
  return undefined;
}

/** The note in a column chunk's `Note: …` line (the column's `Column notes` item), if any. */
function columnNote(text: string): string | undefined {
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!.trim();
    if (line.startsWith("Note: ")) return line.slice("Note: ".length).trim() || undefined;
  }
  return undefined;
}

/** The chunk's text with its `# heading` line kept as a plain line. */
function headingKept(text: string): string {
  return text.trim().replace(/^#+\s*/, "");
}

function stripHeaderLine(text: string): string {
  if (text.startsWith("#")) {
    const nl = text.indexOf("\n");
    return nl === -1 ? "" : text.slice(nl + 1).trim();
  }
  return text.trim();
}
