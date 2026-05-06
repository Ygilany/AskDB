import type { AskDbSchemaFile, NormalizedSchema } from "./types.js";

export function normalizeAskDbSchema(parsed: AskDbSchemaFile): NormalizedSchema {
  return {
    tables: parsed.tables.map((t) => ({
      name: t.name,
      ...(t.sensitive === true ? { sensitive: true as const } : {}),
      columns: t.columns.map((c) => ({
        name: c.name,
        type: c.type,
        nullable: c.nullable ?? true,
        primaryKey: c.primaryKey ?? false,
        ...(c.sensitive === true ? { sensitive: true as const } : {}),
      })),
    })),
  };
}

/** Options for {@link formatSchemaForNlToSql}. */
export type FormatNlToSqlOptions = {
  /**
   * When true, sensitive table/column identifiers are **omitted** from NL→SQL DDL (stricter).
   * Default **false** — names are **included** and tagged `(sensitive)` so the model can ground SQL without hallucinating missing columns.
   */
  omitSensitiveIdentifiersFromPrompt?: boolean;
};

/** Stats when building DDL for NL→SQL (meaning depends on {@link FormatNlToSqlOptions.omitSensitiveIdentifiersFromPrompt}). */
export type NlToSqlSchemaFormatStats = {
  omitSensitiveIdentifiersFromPrompt: boolean;
  /** When omitting: columns withheld from DDL. When including: always 0. */
  redactedColumnCount: number;
  /** When omitting: tables fully stubbed. When including: always 0. */
  sensitiveTableStubCount: number;
  /** When including: sensitive-marked columns listed in DDL (with `(sensitive)`). When omitting: always 0. */
  listedSensitiveColumnCount: number;
};

function columnLine(
  c: NormalizedSchema["tables"][0]["columns"][0],
  tableSensitive: boolean,
): { line: string; listedSensitive: boolean } {
  const flags = [
    c.primaryKey ? "PK" : "",
    c.nullable ? "NULL" : "NOT NULL",
  ]
    .filter(Boolean)
    .join(" ");
  const base = `  - ${c.name} ${c.type}${flags ? ` (${flags})` : ""}`;
  const sensitive = Boolean(tableSensitive || c.sensitive);
  const listedSensitive = sensitive;
  const line = sensitive ? `${base} (sensitive)` : base;
  return { line, listedSensitive };
}

/**
 * Format schema for LLM prompts. By default, **includes** sensitive column/table names (tagged) so NL→SQL can
 * ground identifiers; set {@link FormatNlToSqlOptions.omitSensitiveIdentifiersFromPrompt} to omit them.
 */
export function formatSchemaForNlToSql(
  schema: NormalizedSchema,
  options: FormatNlToSqlOptions = {},
): {
  ddl: string;
  stats: NlToSqlSchemaFormatStats;
} {
  const omit = options.omitSensitiveIdentifiersFromPrompt === true;
  let redactedColumnCount = 0;
  let sensitiveTableStubCount = 0;
  let listedSensitiveColumnCount = 0;
  const lines: string[] = [];

  for (const t of schema.tables) {
    lines.push(`TABLE ${t.name}`);
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
        const { line } = columnLine(c, false);
        lines.push(line);
      }
      if (visibleColumns === 0 && t.columns.length > 0) {
        lines.push(`  (all columns marked sensitive — definitions withheld from model context)`);
      }
    } else {
      for (const c of t.columns) {
        const { line, listedSensitive } = columnLine(c, Boolean(t.sensitive));
        if (listedSensitive) {
          listedSensitiveColumnCount++;
        }
        lines.push(line);
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

/** Same DDL as {@link formatSchemaForNlToSql} with default options (sensitive names included, tagged). */
export function formatSchemaForPrompt(schema: NormalizedSchema, options?: FormatNlToSqlOptions): string {
  return formatSchemaForNlToSql(schema, options).ddl;
}
