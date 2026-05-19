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
 * `formatSchemaV2ForNlToSql` does.
 */
export function synthesizeRetrievedDdl(args: {
  schema: NormalizedSchemaV2;
  results: RetrievedResult[];
  /** Mirrors `formatSchemaV2ForNlToSql`'s `omitSensitiveIdentifiersFromPrompt`. */
  omitSensitiveIdentifiersFromPrompt?: boolean;
}): { ddl: string; tablesEmitted: number; chunksUsed: number } {
  const { schema, results } = args;
  const omit = args.omitSensitiveIdentifiersFromPrompt === true;

  const tableIds = new Set<string>();
  const cqlPerTable = new Map<string, RetrievedResult["payload"][]>();
  const concepts: RetrievedResult["payload"][] = [];
  const questions: RetrievedResult["payload"][] = [];
  const relationships: RetrievedResult["payload"][] = [];
  const tenantPolicyChunks: RetrievedResult["payload"][] = [];

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
          list.push(p);
          cqlPerTable.set(tid, list);
        }
        break;
      }
      case "question": {
        questions.push(p);
        if (p.refs[0]) tableIds.add(p.refs[0]);
        break;
      }
      case "concept": {
        concepts.push(p);
        for (const ref of p.refs) {
          if (ref.startsWith("table:")) {
            const hash = ref.indexOf("#");
            tableIds.add(hash === -1 ? ref : ref.slice(0, hash));
          }
        }
        break;
      }
      case "relationship": {
        relationships.push(p);
        for (const ref of p.refs) {
          if (ref.startsWith("table:") && !ref.includes("#")) tableIds.add(ref);
        }
        break;
      }
      case "tenant-policy": {
        tenantPolicyChunks.push(p);
        break;
      }
    }
  }

  const lines: string[] = [];
  let tablesEmitted = 0;

  for (const t of schema.tables) {
    if (!tableIds.has(t.id)) continue;
    tablesEmitted++;
    const qualifiedName = `${t.schema}.${t.name}`;
    const aliasNote =
      !t.sensitive && t.aliases?.length ? ` -- aliases: ${t.aliases.join(", ")}` : "";
    lines.push(`TABLE ${qualifiedName}${aliasNote}`);
    if (!t.sensitive && t.description) lines.push(`-- ${t.description}`);

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
      let line = `  - ${c.name} ${c.type} (${flags.join(" ")})${sensitiveTag}`;
      if (!c.sensitive && !t.sensitive) {
        const extras: string[] = [];
        if (c.aliases?.length) extras.push(`aliases: ${c.aliases.join(", ")}`);
        if (c.enum?.length) extras.push(`values: ${c.enum.join("|")}`);
        if (c.description) extras.push(c.description);
        if (extras.length) line += ` -- ${extras.join("; ")}`;
      }
      lines.push(line);
    }

    const cqlList = cqlPerTable.get(t.id);
    if (cqlList && cqlList.length > 0 && !t.sensitive) {
      lines.push(`-- common query language --`);
      for (const cql of cqlList) {
        const body = stripHeaderLine(cql.text);
        for (const cqlLine of body.split("\n")) {
          lines.push(`-- ${cqlLine}`);
        }
      }
    }
    lines.push("");
  }

  if (relationships.length > 0) {
    lines.push("-- relationships --");
    for (const r of relationships) {
      lines.push(`-- ${stripHeaderLine(r.text).replace(/\n+/g, " ")}`);
    }
    lines.push("");
  }

  if (concepts.length > 0) {
    lines.push("-- concepts --");
    for (const c of concepts) {
      lines.push(`-- ${stripHeaderLine(c.text).replace(/\n+/g, "; ")}`);
    }
    lines.push("");
  }

  if (questions.length > 0) {
    lines.push("-- example questions for context --");
    for (const q of questions) {
      lines.push(`-- ${stripHeaderLine(q.text).replace(/\n+/g, " ")}`);
    }
    lines.push("");
  }

  if (tenantPolicyChunks.length > 0) {
    lines.push("-- tenant policy context --");
    for (const tp of tenantPolicyChunks) {
      lines.push(`-- ${stripHeaderLine(tp.text).replace(/\n+/g, "; ")}`);
    }
    lines.push("");
  }

  return {
    ddl: lines.join("\n").trimEnd(),
    tablesEmitted,
    chunksUsed: results.length,
  };
}

function stripHeaderLine(text: string): string {
  if (text.startsWith("#")) {
    const nl = text.indexOf("\n");
    return nl === -1 ? "" : text.slice(nl + 1).trim();
  }
  return text.trim();
}
