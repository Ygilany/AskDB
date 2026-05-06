import type { AskDbSchemaFile, NormalizedSchema } from "./types.js";

export function normalizeAskDbSchema(parsed: AskDbSchemaFile): NormalizedSchema {
  return {
    tables: parsed.tables.map((t) => ({
      name: t.name,
      columns: t.columns.map((c) => ({
        name: c.name,
        type: c.type,
        nullable: c.nullable ?? true,
        primaryKey: c.primaryKey ?? false,
      })),
    })),
  };
}

export function formatSchemaForPrompt(schema: NormalizedSchema): string {
  const lines: string[] = [];
  for (const t of schema.tables) {
    lines.push(`TABLE ${t.name}`);
    for (const c of t.columns) {
      const flags = [
        c.primaryKey ? "PK" : "",
        c.nullable ? "NULL" : "NOT NULL",
      ]
        .filter(Boolean)
        .join(" ");
      lines.push(`  - ${c.name} ${c.type}${flags ? ` (${flags})` : ""}`);
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}
