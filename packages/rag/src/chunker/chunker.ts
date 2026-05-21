import type {
  NormalizedSchemaV2,
  NormalizedV2Column,
  NormalizedV2Table,
  ParsedTableMarkdown,
  ParsedTenantPolicyMarkdown,
  V2Concept,
} from "@askdb/core";
import type { Chunk } from "../types.js";
import {
  DEFAULT_CHUNK_MAX_CHARS,
  type ChunkOptions,
} from "./options.js";
import type { ChunkerSources } from "./sources.js";

/**
 * Statistics returned alongside the chunks. Counts only — never identifiers.
 *
 * The indexer surfaces these as structured logs (`askdb.rag.sensitive_chunks_excluded`,
 * `askdb.rag.sensitive_chunks_included`) so operators can observe policy changes
 * without leaking data.
 */
export type ChunkStats = {
  totalChunks: number;
  byType: Record<Chunk["type"], number>;
  /** Describable-layer chunks dropped because the source content references a sensitive column/table. */
  sensitiveExcluded: number;
  /** Describable-layer chunks emitted **only because** `includeSensitiveDescribable: true` was set. */
  sensitiveIncluded: number;
};

/** Result of {@link chunkSchema}. */
export type ChunkResult = {
  chunks: Chunk[];
  stats: ChunkStats;
};

/**
 * Deterministic chunker for a Schema v2 artifact.
 *
 * Inputs are pre-loaded sources (the `loadSchema` normalized form **plus** the
 * raw parsed markdowns — the normalized form intentionally drops example
 * questions, business context, and column-notes which the chunker needs).
 *
 * Determinism is a contract: same artifact → same chunk ids and same chunk
 * texts on every run, regardless of file-system ordering, OS, or Node version.
 * The final chunk array is sorted by id.
 */
export function chunkSchema(
  sources: ChunkerSources,
  options: ChunkOptions = {},
): ChunkResult {
  const includeSensitive = options.includeSensitiveDescribable === true;
  const maxChars = options.chunkSizeMaxChars ?? DEFAULT_CHUNK_MAX_CHARS;
  const emitRelationships = options.emitRelationships === true;

  const chunks: Chunk[] = [];
  const stats: ChunkStats = {
    totalChunks: 0,
    byType: {
      table: 0,
      column: 0,
      cql: 0,
      question: 0,
      concept: 0,
      relationship: 0,
      "tenant-policy": 0,
    },
    sensitiveExcluded: 0,
    sensitiveIncluded: 0,
  };

  const { schema, tables: tableMarkdowns, concepts } = sources;

  for (const table of schema.tables) {
    if (table.tracked === false) {
      continue;
    }

    const md = tableMarkdowns[table.id];
    const sensitiveColumnNames = table.columns
      .filter((c) => c.sensitive)
      .map((c) => c.name);

    if (table.sensitive && !includeSensitive) {
      stats.sensitiveExcluded++;
    } else {
      chunks.push(buildTableChunk(table, schema.schemaId, includeSensitive, schema));
    }

    // Column chunks — one per column. Identifier + type always; describable
    // fields only when not sensitive (or when opted in).
    for (const col of table.columns) {
      const colNote = readColumnNote(md, col.name);
      const colSensitive = col.sensitive || table.sensitive;
      if (colSensitive && !includeSensitive) {
        stats.sensitiveExcluded++;
        continue;
      } else if (colSensitive && includeSensitive) {
        if (col.description || (col.aliases && col.aliases.length) || (col.enum && col.enum.length) || colNote) {
          stats.sensitiveIncluded++;
        }
      }
      chunks.push(
        buildColumnChunk(table, col, schema.schemaId, colNote, includeSensitive),
      );
    }

    // CQL chunk — excluded entirely if the body mentions a sensitive column by name.
    if (table.commonQueryLanguage) {
      const mentionsSensitive = mentionsAnyName(
        table.commonQueryLanguage,
        sensitiveColumnNames,
      );
      const tableLevelSensitive = table.sensitive;
      const skip =
        (tableLevelSensitive || mentionsSensitive) && !includeSensitive;
      if (skip) {
        stats.sensitiveExcluded++;
      } else {
        if (tableLevelSensitive || mentionsSensitive) {
          stats.sensitiveIncluded++;
        }
        for (const part of splitLong(table.commonQueryLanguage, maxChars)) {
          chunks.push(
            buildCqlChunk(
              table,
              part.text,
              part.suffix,
              schema.schemaId,
              tableLevelSensitive || mentionsSensitive,
            ),
          );
        }
      }
    }

    // Example-question chunks — one per bullet item.
    if (md) {
      const questions = extractExampleQuestions(md);
      const businessContext = md.sections["Business context"]?.trim() ?? "";
      const questionsMentionSensitive = questions.some((q) =>
        mentionsAnyName(q, sensitiveColumnNames),
      );
      const bizMentionsSensitive = mentionsAnyName(
        businessContext,
        sensitiveColumnNames,
      );

      // Per-table sensitive gate: if table is sensitive OR mentions exist, skip
      // the *whole* describable layer for that table by default. Authoring rule
      // in the contract notes the chunker excludes whole chunks rather than
      // partially redacting prose.
      const skipQuestions =
        (table.sensitive || questionsMentionSensitive) && !includeSensitive;
      if (questions.length > 0) {
        if (skipQuestions) {
          stats.sensitiveExcluded += questions.length;
        } else {
          if (table.sensitive || questionsMentionSensitive) {
            stats.sensitiveIncluded += questions.length;
          }
          questions.forEach((q, i) => {
            chunks.push(
              buildQuestionChunk(
                table,
                q,
                i + 1,
                schema.schemaId,
                table.sensitive || mentionsAnyName(q, sensitiveColumnNames),
              ),
            );
          });
        }
      }

      // Business-context chunks are part of the describable layer; same gate.
      if (businessContext) {
        const skipBiz =
          (table.sensitive || bizMentionsSensitive) && !includeSensitive;
        if (skipBiz) {
          stats.sensitiveExcluded++;
        } else {
          if (table.sensitive || bizMentionsSensitive) {
            stats.sensitiveIncluded++;
          }
          for (const part of splitLong(businessContext, maxChars)) {
            chunks.push(
              buildBusinessContextChunk(
                table,
                part.text,
                part.suffix,
                schema.schemaId,
                table.sensitive || bizMentionsSensitive,
              ),
            );
          }
        }
      }
    }

    // Optional relationship chunks
    if (emitRelationships && table.relationships) {
      for (const rel of table.relationships) {
        const chunk = buildRelationshipChunk(table, rel, schema, schema.schemaId);
        if (chunk.sensitive && !includeSensitive) {
          stats.sensitiveExcluded++;
          continue;
        }
        if (chunk.sensitive) stats.sensitiveIncluded++;
        chunks.push(chunk);
      }
    }
  }

  // Concept chunks. Concepts that link to sensitive columns include link
  // metadata but their description is filtered if it names a sensitive col.
  if (concepts?.frontmatter.concepts) {
    const allSensitiveColumnNames = collectSensitiveColumnNames(schema);
    for (const concept of concepts.frontmatter.concepts) {
      const conceptResult = buildConceptChunk(
        concept,
        schema.schemaId,
        schema,
        allSensitiveColumnNames,
        includeSensitive,
      );
      if (conceptResult.excluded) {
        stats.sensitiveExcluded++;
        if (includeSensitive) {
          stats.sensitiveIncluded++;
          chunks.push(conceptResult.chunk);
        }
      } else {
        if (conceptResult.sensitive) stats.sensitiveIncluded++;
        chunks.push(conceptResult.chunk);
      }
    }
  }

  // Tenant policy body chunks — one per H2 section.
  if (sources.tenantPolicy) {
    for (const chunk of buildTenantPolicyChunks(sources.tenantPolicy, schema.schemaId, maxChars)) {
      chunks.push(chunk);
    }
  }

  // Final ordering: stable by id (string compare). The chunker itself emits in
  // deterministic order already, but a final sort guards against future
  // reorderings of the source iteration.
  chunks.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  for (const c of chunks) {
    stats.byType[c.type]++;
  }
  stats.totalChunks = chunks.length;

  return { chunks, stats };
}

// ---------- chunk builders ----------

function buildTableChunk(
  table: NormalizedV2Table,
  schemaId: string,
  includeSensitive: boolean,
  schema: NormalizedSchemaV2,
): Chunk {
  const lines: string[] = [];
  const qualified = `${table.schema}.${table.name}`;
  lines.push(`# ${qualified}`);
  if (!table.sensitive) {
    if (table.description) lines.push(table.description);
    if (table.aliases?.length) lines.push(`Aliases: ${table.aliases.join(", ")}`);
    if (table.primaryEntity) lines.push(`Primary entity: ${table.primaryEntity}`);
  }
  if (table.relationships?.length) {
    lines.push("Relationships:");
    for (const r of table.relationships) {
      if (!includeSensitive && (isSensitiveId(r.from, schema) || isSensitiveId(r.to, schema))) {
        continue;
      }
      lines.push(`- ${r.from} -> ${r.to}`);
    }
  }
  lines.push("Columns:");
  const referencedColumns: string[] = [];
  for (const c of table.columns) {
    if ((c.sensitive || table.sensitive) && !includeSensitive) continue;
    referencedColumns.push(c.id);
    const flags: string[] = [];
    if (c.primaryKey) flags.push("PK");
    flags.push(c.nullable ? "NULL" : "NOT NULL");
    const tag = c.sensitive || table.sensitive ? " (sensitive)" : "";
    const desc =
      !table.sensitive && !c.sensitive && c.description
        ? ` — ${c.description}`
        : "";
    lines.push(`- ${c.name} ${c.type} (${flags.join(" ")})${tag}${desc}`);
  }
  return {
    id: `chunk:${table.id}`,
    type: "table",
    text: lines.join("\n").trim(),
    schemaId,
    refs: [table.id, ...referencedColumns],
    sensitive: table.sensitive,
  };
}

function buildColumnChunk(
  table: NormalizedV2Table,
  col: NormalizedV2Column,
  schemaId: string,
  columnNote: string | undefined,
  includeSensitive: boolean,
): Chunk {
  const sensitive = col.sensitive || table.sensitive;
  const flags: string[] = [];
  if (col.primaryKey) flags.push("PK");
  flags.push(col.nullable ? "NULL" : "NOT NULL");
  const lines: string[] = [];
  const qualified = `${table.schema}.${table.name}.${col.name}`;
  lines.push(`Column: ${qualified} ${col.type} (${flags.join(" ")})${sensitive ? " (sensitive)" : ""}`);
  lines.push(`Id: ${col.id}`);
  if (!sensitive || includeSensitive) {
    if (col.description) lines.push(col.description);
    if (col.aliases?.length) lines.push(`Aliases: ${col.aliases.join(", ")}`);
    if (col.enum?.length) lines.push(`Values: ${col.enum.join(", ")}`);
    if (columnNote) lines.push(`Note: ${columnNote}`);
  }
  return {
    id: `chunk:${col.id}`,
    type: "column",
    text: lines.join("\n").trim(),
    schemaId,
    refs: [table.id, col.id],
    sensitive,
  };
}

function buildCqlChunk(
  table: NormalizedV2Table,
  body: string,
  suffix: string,
  schemaId: string,
  sensitive: boolean,
): Chunk {
  const aliasNote = table.aliases?.length
    ? ` (also: ${table.aliases.join(", ")})`
    : "";
  const text = `# ${table.schema}.${table.name}${aliasNote} — common query language\n${body.trim()}`;
  const id = `chunk:${table.id}#cql${suffix}`;
  return {
    id,
    type: "cql",
    text,
    schemaId,
    refs: [table.id],
    sensitive,
  };
}

function buildQuestionChunk(
  table: NormalizedV2Table,
  question: string,
  index: number,
  schemaId: string,
  sensitive: boolean,
): Chunk {
  const entity = table.primaryEntity ? ` [${table.primaryEntity}]` : "";
  const text = `# ${table.schema}.${table.name}${entity} — example question\n${question.trim()}`;
  return {
    id: `chunk:${table.id}#q:${index}`,
    type: "question",
    text,
    schemaId,
    refs: [table.id],
    sensitive,
  };
}

function buildBusinessContextChunk(
  table: NormalizedV2Table,
  body: string,
  suffix: string,
  schemaId: string,
  sensitive: boolean,
): Chunk {
  const text = `# ${table.schema}.${table.name} — business context\n${body.trim()}`;
  return {
    id: `chunk:${table.id}#biz${suffix}`,
    type: "table",
    text,
    schemaId,
    refs: [table.id],
    sensitive,
  };
}

function buildRelationshipChunk(
  table: NormalizedV2Table,
  rel: { from: string; to: string },
  schema: NormalizedSchemaV2,
  schemaId: string,
): Chunk {
  const fromCol = parseColumnId(rel.from);
  const toCol = parseColumnId(rel.to);
  const fromTable = schema.tables.find((t) => t.id === fromCol.tableId);
  const toTable = schema.tables.find((t) => t.id === toCol.tableId);
  const fromName = fromTable ? `${fromTable.schema}.${fromTable.name}` : fromCol.tableId;
  const toName = toTable ? `${toTable.schema}.${toTable.name}` : toCol.tableId;
  const text = `Relationship: ${fromName}.${fromCol.column} references ${toName}.${toCol.column}`;
  const sensitive = (fromTable?.sensitive ?? false) || (toTable?.sensitive ?? false);
  return {
    id: `chunk:${rel.from}->${rel.to}`,
    type: "relationship",
    text,
    schemaId,
    refs: [fromCol.tableId, toCol.tableId, rel.from, rel.to],
    sensitive,
  };
}

function buildConceptChunk(
  concept: V2Concept,
  schemaId: string,
  schema: NormalizedSchemaV2,
  allSensitiveColumnNames: string[],
  includeSensitive: boolean,
): { chunk: Chunk; sensitive: boolean; excluded: boolean } {
  const linkedSensitive = (concept.links ?? []).some((id) =>
    isSensitiveId(id, schema),
  );
  const descriptionMentionsSensitive = concept.description
    ? mentionsAnyName(concept.description, allSensitiveColumnNames)
    : false;

  const lines: string[] = [];
  lines.push(`# Concept: ${concept.label}`);
  lines.push(`Id: ${concept.id}`);
  if (concept.synonyms?.length) lines.push(`Synonyms: ${concept.synonyms.join(", ")}`);
  if (concept.links?.length) lines.push(`Links: ${concept.links.join(", ")}`);

  const excludeForSensitive = (linkedSensitive || descriptionMentionsSensitive) && !includeSensitive;

  if (concept.description && (!descriptionMentionsSensitive || includeSensitive)) {
    lines.push(concept.description);
  }

  return {
    chunk: {
      id: `chunk:${concept.id}`,
      type: "concept",
      text: lines.join("\n").trim(),
      schemaId,
      refs: [concept.id, ...(concept.links ?? [])],
      sensitive: linkedSensitive || descriptionMentionsSensitive,
    },
    sensitive: linkedSensitive || descriptionMentionsSensitive,
    excluded: excludeForSensitive,
  };
}

function buildTenantPolicyChunks(
  tenantPolicy: ParsedTenantPolicyMarkdown,
  schemaId: string,
  maxChars: number,
): Chunk[] {
  const chunks: Chunk[] = [];
  const sections = tenantPolicy.sections;

  for (const [sectionName, sectionBody] of Object.entries(sections)) {
    if (!sectionBody?.trim()) continue;
    const slug = sectionName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    for (const part of splitLong(sectionBody.trim(), maxChars)) {
      chunks.push({
        id: `chunk:tenant-policy#${slug}${part.suffix}`,
        type: "tenant-policy",
        text: `# Tenant policy — ${sectionName}\n${part.text}`,
        schemaId,
        refs: [],
        sensitive: false,
      });
    }
  }

  if (chunks.length === 0 && tenantPolicy.body.trim()) {
    for (const part of splitLong(tenantPolicy.body.trim(), maxChars)) {
      chunks.push({
        id: `chunk:tenant-policy#body${part.suffix}`,
        type: "tenant-policy",
        text: `# Tenant policy\n${part.text}`,
        schemaId,
        refs: [],
        sensitive: false,
      });
    }
  }

  return chunks;
}

// ---------- helpers ----------

function readColumnNote(
  md: ParsedTableMarkdown | undefined,
  columnName: string,
): string | undefined {
  const body = md?.sections["Column notes"];
  if (!body) return undefined;
  const lines = body.split("\n");
  for (const raw of lines) {
    const line = raw.trim();
    if (!line.startsWith("-")) continue;
    const stripped = line.slice(1).trim();
    // Match `column_name`: ... or `column_name` — ...
    const match = stripped.match(/^`([^`]+)`\s*[:\-—]\s*(.+)$/);
    if (match && match[1] === columnName) {
      return match[2].trim();
    }
  }
  return undefined;
}

function extractExampleQuestions(md: ParsedTableMarkdown): string[] {
  const body = md.sections["Example questions"];
  if (!body) return [];
  const out: string[] = [];
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("- ")) out.push(line.slice(2).trim());
    else if (line.startsWith("* ")) out.push(line.slice(2).trim());
  }
  return out;
}

function mentionsAnyName(text: string, names: string[]): boolean {
  if (!text || names.length === 0) return false;
  for (const name of names) {
    // Word-boundary match (also matches when wrapped in backticks).
    const pattern = new RegExp(`(^|[^a-zA-Z0-9_])${escapeRegex(name)}([^a-zA-Z0-9_]|$)`);
    if (pattern.test(text)) return true;
  }
  return false;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Split a long body on paragraph boundaries; suffix is `""` for single-chunk, `#bc:N` (1-indexed) otherwise. */
function splitLong(body: string, maxChars: number): { text: string; suffix: string }[] {
  const trimmed = body.trim();
  if (trimmed.length <= maxChars) return [{ text: trimmed, suffix: "" }];

  const paragraphs = trimmed.split(/\n\s*\n/);
  const out: { text: string; suffix: string }[] = [];
  let buf: string[] = [];
  let bufLen = 0;
  let idx = 1;

  const flush = () => {
    if (buf.length === 0) return;
    out.push({ text: buf.join("\n\n").trim(), suffix: `#bc:${idx++}` });
    buf = [];
    bufLen = 0;
  };

  for (const p of paragraphs) {
    const pLen = p.length;
    if (bufLen + pLen > maxChars && buf.length > 0) {
      flush();
    }
    buf.push(p);
    bufLen += pLen + 2;
  }
  flush();

  return out;
}

function parseColumnId(columnId: string): { tableId: string; column: string } {
  const hashIdx = columnId.indexOf("#");
  if (hashIdx === -1) return { tableId: columnId, column: "" };
  return {
    tableId: columnId.slice(0, hashIdx),
    column: columnId.slice(hashIdx + 1),
  };
}

function collectSensitiveColumnNames(schema: NormalizedSchemaV2): string[] {
  const names = new Set<string>();
  for (const t of schema.tables) {
    for (const c of t.columns) {
      if (c.sensitive || t.sensitive) names.add(c.name);
    }
  }
  return Array.from(names);
}

function isSensitiveId(id: string, schema: NormalizedSchemaV2): boolean {
  for (const t of schema.tables) {
    if (t.id === id) return t.sensitive;
    for (const c of t.columns) {
      if (c.id === id) return c.sensitive || t.sensitive;
    }
  }
  return false;
}
