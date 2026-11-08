import type { NormalizedSchemaV2 } from "./normalized.js";
import type { FormatNlToSqlOptions, NlToSqlSchemaFormatStats } from "../normalize.js";
import { createMentionMatcher, sensitiveMentionNames } from "./mentions.js";

/**
 * Format a NormalizedSchemaV2 for NL→SQL prompts.
 *
 * Interleaves table descriptions, aliases, column descriptions, and
 * `Common query language` blocks when present in the describable layer.
 * Sensitive describable-layer fields (descriptions/aliases/enum) are
 * excluded per the schema-v2 contract. With `omitSensitiveIdentifiersFromPrompt`,
 * describable text that names a sensitive column is withheld too
 * ({@link promptTextGate}).
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

    // Common query language block
    if (!t.sensitive && t.commonQueryLanguage && gate.allows(t.commonQueryLanguage)) {
      lines.push(`-- common query language --`);
      for (const cqlLine of t.commonQueryLanguage.split("\n")) {
        lines.push(`-- ${cqlLine}`);
      }
    }

    lines.push("");
  }

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
