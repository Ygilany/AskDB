import type { NormalizedSchemaV2 } from "./normalized.js";
import type { FormatNlToSqlOptions, NlToSqlSchemaFormatStats } from "../normalize.js";
import { createMentionMatcher, sensitiveMentionNames } from "./mentions.js";

/**
 * Format a NormalizedSchemaV2 for NL→SQL prompts.
 *
 * Interleaves table descriptions, aliases, column descriptions, each table's
 * foreign keys ({@link foreignKeyLinesByTable}) and `Common query language`
 * blocks when present in the describable layer, then the schema's concepts
 * ({@link conceptLines}). Sensitive describable-layer fields
 * (descriptions/aliases/enum) are excluded per the schema-v2 contract. With
 * `omitSensitiveIdentifiersFromPrompt`, describable text that names a sensitive
 * column is withheld too ({@link promptTextGate}).
 */
export function formatSchemaV2ForNlToSql(
  schema: NormalizedSchemaV2,
  options: FormatNlToSqlOptions = {},
): { ddl: string; stats: NlToSqlSchemaFormatStats } {
  const omit = options.omitSensitiveIdentifiersFromPrompt === true;
  const quoteIdentifier = options.quoteIdentifier ?? listAsStored;
  const gate = promptTextGate(schema, omit);
  let redactedColumnCount = 0;
  let sensitiveTableStubCount = 0;
  let listedSensitiveColumnCount = 0;
  let untrackedTableCount = 0;
  const lines: string[] = [];
  const foreignKeys = foreignKeyLinesByTable(schema, { omit, unqualifiedNamespace: options.unqualifiedNamespace, quoteIdentifier });

  for (const t of schema.tables) {
    if (t.tracked === false) {
      untrackedTableCount++;
      continue;
    }

    // Table header — qualified with its schema unless that namespace isn't one; alias annotation when present
    const listedName = promptTableName(t, options.unqualifiedNamespace, quoteIdentifier);
    lines.push(`TABLE ${listedName}${tableAliasNote(t, gate)}`);

    // Table description as a comment line
    if (!t.sensitive && t.description && gate.allows(t.description)) {
      lines.push(`-- ${t.description}`);
    }

    if (omit && t.sensitive) {
      sensitiveTableStubCount++;
      redactedColumnCount += t.columns.length;
      lines.push(`  (sensitive table — column definitions withheld from model context)`);
      lines.push("");
      continue;
    }

    if (omit) {
      let visibleColumns = 0;
      for (const c of t.columns) {
        if (c.sensitive) {
          redactedColumnCount++;
          continue;
        }
        visibleColumns++;
        lines.push(buildColumnLine(c, false, false, quoteIdentifier, gate));
      }
      if (visibleColumns === 0 && t.columns.length > 0) {
        lines.push(`  (all columns marked sensitive — definitions withheld from model context)`);
      }
    } else {
      for (const c of t.columns) {
        if (c.sensitive) listedSensitiveColumnCount++;
        lines.push(buildColumnLine(c, c.sensitive, t.sensitive, quoteIdentifier, gate));
      }
    }

    lines.push(...(foreignKeys.get(t.id) ?? []));

    // Common query language block
    if (!t.sensitive && t.commonQueryLanguage && gate.allows(t.commonQueryLanguage)) {
      lines.push(`-- common query language --`);
      for (const cqlLine of t.commonQueryLanguage.split("\n")) {
        lines.push(`-- ${cqlLine}`);
      }
    }

    lines.push("");
  }

  lines.push(...conceptLines(schema, gate, { unqualifiedNamespace: options.unqualifiedNamespace, quoteIdentifier }));

  const ddl = lines.join("\n").trimEnd();
  return {
    ddl,
    stats: {
      omitSensitiveIdentifiersFromPrompt: omit,
      redactedColumnCount,
      sensitiveTableStubCount,
      listedSensitiveColumnCount,
      untrackedTableCount,
      mentionDroppedCount: gate.withheld,
    },
  };
}

/**
 * Decides which describable text an NL→SQL prompt may show. With sensitive identifiers
 * omitted, text that names a sensitive column (ADR 0017's names, the schema v2 contract's
 * mention rule) is withheld and counted; otherwise every text is shown.
 */
type PromptTextGate = {
  /**
   * Whether `text`, as the prompt renders it, may go in. With omission on, a text that names a
   * sensitive column is withheld, and so is one whose source is `flagged` sensitive (a retrieved
   * chunk's `sensitive`). Each withheld text counts once.
   */
  allows(text: string, flagged?: boolean): boolean;
  /** How many texts were withheld so far. */
  readonly withheld: number;
};

/** The {@link PromptTextGate} both NL→SQL prompt builders use for `schema`. */
export function promptTextGate(schema: NormalizedSchemaV2, omit: boolean): PromptTextGate {
  const matcher = omit ? createMentionMatcher(sensitiveMentionNames(schema)) : undefined;
  let withheld = 0;
  return {
    allows(text, flagged = false) {
      if (!matcher || (!flagged && !matcher.mentionsAny(text))) return true;
      withheld++;
      return false;
    },
    get withheld() {
      return withheld;
    },
  };
}

/** A non-sensitive table's ` -- aliases: …` header note, each alias shown only when the gate allows it. */
export function tableAliasNote(t: NormalizedSchemaV2["tables"][0], gate: PromptTextGate): string {
  if (t.sensitive || !t.aliases?.length) return "";
  const aliases = t.aliases.filter((alias) => gate.allows(alias));
  return aliases.length ? ` -- aliases: ${aliases.join(", ")}` : "";
}

/**
 * A non-sensitive column's annotation (`aliases: …; values: …; description; note: …`), or `""`.
 * The parts are one unit, checked as rendered: when they name a sensitive column, the gate
 * withholds all of them. `retrieved` is a retrieved column chunk's `Column notes` line and its
 * `sensitive` flag (the retrieval prompt only): the note joins the unit, as it joins the column's
 * describable layer in `@askdb/rag`'s chunker, so a flagged chunk withholds the whole annotation.
 */
export function columnAnnotation(
  c: NormalizedSchemaV2["tables"][0]["columns"][0],
  gate: PromptTextGate,
  retrieved: { note: string; sensitive: boolean } | undefined = undefined,
): string {
  const aliases = c.aliases?.length ? c.aliases.join(", ") : "";
  const values = c.enum?.length ? c.enum.join("|") : "";
  const description = c.description ?? "";
  const note = retrieved?.note ?? "";
  const shown = [aliases, values, description, note].filter(Boolean);
  // The fixed labels stay out of the check: a sensitive column named `values` names no annotation.
  if (shown.length === 0 || !gate.allows(shown.join("; "), retrieved?.sensitive)) return "";
  return [aliases && `aliases: ${aliases}`, values && `values: ${values}`, description, note && `note: ${note}`]
    .filter(Boolean)
    .join("; ");
}

/**
 * A table's name as the NL→SQL prompt lists it: `schema.name`, or `name` in the unqualified
 * namespace, each part passed through `quoteIdentifier`.
 */
export function promptTableName(
  table: Pick<NormalizedSchemaV2["tables"][0], "schema" | "name">,
  unqualifiedNamespace: string | undefined,
  quoteIdentifier: (name: string) => string = listAsStored,
): string {
  const name = quoteIdentifier(table.name);
  return table.schema === unqualifiedNamespace ? name : `${quoteIdentifier(table.schema)}.${name}`;
}

/** How a prompt names tables and columns: the options both NL→SQL prompt builders take. */
type PromptNaming = {
  unqualifiedNamespace: string | undefined;
  quoteIdentifier: (name: string) => string;
};

type ColumnRef = { table: NormalizedSchemaV2["tables"][0]; column: NormalizedSchemaV2["tables"][0]["columns"][0] };

function columnRefs(schema: NormalizedSchemaV2): Map<string, ColumnRef> {
  const refs = new Map<string, ColumnRef>();
  for (const table of schema.tables) for (const column of table.columns) refs.set(column.id, { table, column });
  return refs;
}

/**
 * The schema's foreign keys as both NL→SQL prompts print them (#898), keyed by the id of the
 * table that owns each key's column: `  FK (user_id) -> public.users (id)`, after the table's
 * column lines. Each key prints once, from any table's `relationships`. A key is left out when
 * either column doesn't resolve, either table is untracked or not `shown`, or, with `omit`,
 * either column or table is sensitive, so a key never names a column the prompt withholds. A
 * composite key prints one line per column pair until the artifact groups them (#349).
 */
export function foreignKeyLinesByTable(
  schema: NormalizedSchemaV2,
  options: PromptNaming & { omit: boolean; shown?: (tableId: string) => boolean },
): Map<string, string[]> {
  const refs = columnRefs(schema);
  const { quoteIdentifier, unqualifiedNamespace } = options;
  const visible = (ref: ColumnRef | undefined): ref is ColumnRef =>
    ref !== undefined &&
    ref.table.tracked !== false &&
    (options.shown?.(ref.table.id) ?? true) &&
    !(options.omit && (ref.table.sensitive || ref.column.sensitive));
  const byTable = new Map<string, string[]>();
  const printed = new Set<string>();
  for (const table of schema.tables) {
    for (const key of table.relationships ?? []) {
      const from = refs.get(key.from);
      const to = refs.get(key.to);
      if (!visible(from) || !visible(to) || printed.has(`${key.from}->${key.to}`)) continue;
      printed.add(`${key.from}->${key.to}`);
      const target = promptTableName(to.table, unqualifiedNamespace, quoteIdentifier);
      const line = `  FK (${quoteIdentifier(from.column.name)}) -> ${target} (${quoteIdentifier(to.column.name)})`;
      byTable.set(from.table.id, [...(byTable.get(from.table.id) ?? []), line]);
    }
  }
  return byTable;
}

/**
 * The schema's concepts as the full-schema prompt lists them after the tables (#898): a
 * `-- concepts --` block with one line per concept, its label, synonyms, links (named as the
 * prompt names tables and columns) and description. A link to an untracked table is dropped,
 * and so is a concept whose links are all untracked. The gate checks each line as rendered,
 * without its fixed labels; a concept that links a sensitive table or column is flagged, so
 * omission withholds it too. `[]` when no concept is left.
 */
export function conceptLines(schema: NormalizedSchemaV2, gate: PromptTextGate, naming: PromptNaming): string[] {
  const refs = columnRefs(schema);
  const tables = new Map(schema.tables.map((table) => [table.id, table]));
  const lines: string[] = [];
  for (const concept of schema.concepts ?? []) {
    const links: string[] = [];
    let untracked = 0;
    let linksSensitive = false;
    for (const id of concept.links ?? []) {
      const column = refs.get(id);
      const table = column?.table ?? tables.get(id);
      if (!table) continue;
      if (table.tracked === false) {
        untracked++;
        continue;
      }
      const tableName = promptTableName(table, naming.unqualifiedNamespace, naming.quoteIdentifier);
      links.push(column ? `${tableName}.${naming.quoteIdentifier(column.column.name)}` : tableName);
      linksSensitive ||= table.sensitive || (column?.column.sensitive ?? false);
    }
    if (untracked > 0 && links.length === 0) continue;
    const synonyms = concept.synonyms?.length ? concept.synonyms.join(", ") : "";
    const description = concept.description?.replace(/\s*\n\s*/g, " ") ?? "";
    const shown = [concept.label, synonyms, links.join(", "), description].filter(Boolean).join("; ");
    if (!gate.allows(shown, linksSensitive)) continue;
    const parts = [concept.label, synonyms && `synonyms: ${synonyms}`, links.length > 0 && `links: ${links.join(", ")}`, description];
    lines.push(`-- ${parts.filter(Boolean).join("; ")}`);
  }
  return lines.length > 0 ? ["-- concepts --", ...lines, ""] : [];
}

/**
 * A table's `-- business context --` block: each body's lines as `--` comments, blank lines
 * dropped (paragraphs are separated by them; an empty `--` line adds nothing). `[]` for none.
 */
export function businessContextLines(bodies: string[]): string[] {
  const lines = bodies.flatMap((body) => body.split("\n").filter((line) => line.trim()).map((line) => `-- ${line}`));
  return lines.length > 0 ? ["-- business context --", ...lines] : [];
}

/** The default `quoteIdentifier`: a name listed exactly as stored. */
export function listAsStored(name: string): string {
  return name;
}

function buildColumnLine(
  c: NormalizedSchemaV2["tables"][0]["columns"][0],
  colSensitive: boolean,
  tableSensitive: boolean,
  quoteIdentifier: (name: string) => string,
  gate: PromptTextGate,
): string {
  const effective = colSensitive || tableSensitive;
  const flags = [c.primaryKey ? "PK" : "", c.nullable ? "NULL" : "NOT NULL"]
    .filter(Boolean)
    .join(" ");
  let line = `  - ${quoteIdentifier(c.name)} ${c.type} (${flags})`;

  if (effective) {
    line += " (sensitive)";
  } else {
    // Append column description when present (describable-layer enrichment)
    const annotation = columnAnnotation(c, gate);
    if (annotation) line += ` -- ${annotation}`;
  }

  return line;
}
