import { SchemaParseError } from "../errors.js";
import { askDbSchemaFileSchema } from "./format.js";
import type { AskDbSchemaFile } from "./types.js";
import { normalizeAskDbSchema } from "./normalize.js";
import type { NormalizedSchema } from "./types.js";

export function parseAskDbSchemaJson(raw: string): AskDbSchemaFile {
  try {
    const data: unknown = JSON.parse(raw);
    const parsed = askDbSchemaFileSchema.safeParse(data);
    if (!parsed.success) {
      throw new SchemaParseError(parsed.error.message, parsed.error);
    }
    const seenTables = new Set<string>();
    for (const table of parsed.data.tables) {
      if (seenTables.has(table.name)) {
        throw new SchemaParseError(`Duplicate table name: ${table.name}`);
      }
      seenTables.add(table.name);
      const cols = new Set<string>();
      for (const col of table.columns) {
        if (cols.has(col.name)) {
          throw new SchemaParseError(`Duplicate column '${col.name}' in table '${table.name}'`);
        }
        cols.add(col.name);
      }
    }
    return parsed.data;
  } catch (e) {
    if (e instanceof SchemaParseError) throw e;
    const message = e instanceof Error ? e.message : String(e);
    throw new SchemaParseError(`Failed to parse schema JSON: ${message}`, e);
  }
}

export function loadNormalizedSchemaFromJson(raw: string): NormalizedSchema {
  return normalizeAskDbSchema(parseAskDbSchemaJson(raw));
}
