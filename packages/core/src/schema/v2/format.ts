import type { NormalizedSchemaV2 } from "./normalized.js";
import type { FormatNlToSqlOptions, NlToSqlSchemaFormatStats } from "../normalize.js";

/**
 * Format a NormalizedSchemaV2 for NL→SQL prompts.
 *
 * Interleaves table descriptions, aliases, column descriptions, and
 * `Common query language` blocks when present in the describable layer.
 * Sensitive describable-layer fields (descriptions/aliases/enum) are
 * excluded per the schema-v2 contract.
 */
export function formatSchemaV2ForNlToSql(
  schema: NormalizedSchemaV2,
  options: FormatNlToSqlOptions = {},
): { ddl: string; stats: NlToSqlSchemaFormatStats } {
  const omit = options.omitSensitiveIdentifiersFromPrompt === true;
  let redactedColumnCount = 0;
  let sensitiveTableStubCount = 0;
  let listedSensitiveColumnCount = 0;
  const lines: string[] = [];

  for (const t of schema.tables) {
    // Table header — always qualify with database schema name; add alias annotation when present
    const qualifiedName = `${t.schema}.${t.name}`;
    const aliasNote =
      !t.sensitive && t.aliases?.length
        ? ` -- aliases: ${t.aliases.join(", ")}`
        : "";
    lines.push(`TABLE ${qualifiedName}${aliasNote}`);

    // Table description as a comment line
    if (!t.sensitive && t.description) {
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
        lines.push(buildColumnLine(c, false, false));
      }
      if (visibleColumns === 0 && t.columns.length > 0) {
        lines.push(`  (all columns marked sensitive — definitions withheld from model context)`);
      }
    } else {
      for (const c of t.columns) {
        if (c.sensitive) listedSensitiveColumnCount++;
        lines.push(buildColumnLine(c, c.sensitive, t.sensitive));
      }
    }

    // Common query language block
    if (!t.sensitive && t.commonQueryLanguage) {
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
    },
  };
}

function buildColumnLine(
  c: NormalizedSchemaV2["tables"][0]["columns"][0],
  colSensitive: boolean,
  tableSensitive: boolean,
): string {
  const effective = colSensitive || tableSensitive;
  const flags = [c.primaryKey ? "PK" : "", c.nullable ? "NULL" : "NOT NULL"]
    .filter(Boolean)
    .join(" ");
  let line = `  - ${c.name} ${c.type}${flags ? ` (${flags})` : ""}`;

  if (effective) {
    line += " (sensitive)";
  } else {
    // Append column description when present (describable-layer enrichment)
    const extras: string[] = [];
    if (c.aliases?.length) extras.push(`aliases: ${c.aliases.join(", ")}`);
    if (c.enum?.length) extras.push(`values: ${c.enum.join("|")}`);
    if (c.description) extras.push(c.description);
    if (extras.length) line += ` -- ${extras.join("; ")}`;
  }

  return line;
}
