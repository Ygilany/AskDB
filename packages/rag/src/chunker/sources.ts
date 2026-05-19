import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  loadSchema,
  loadSchemaFromJson,
  parseConceptsMarkdown,
  parseTableMarkdown,
  parseTenantPolicyMarkdown,
} from "@askdb/core";
import type {
  NormalizedSchemaV2,
  ParsedConceptsMarkdown,
  ParsedTableMarkdown,
  ParsedTenantPolicyMarkdown,
} from "@askdb/core";

/**
 * The chunker consumes both the normalized v2 form **and** the parsed
 * markdown bodies (for `Example questions`, `Business context`, `Column notes`
 * which the normalized form intentionally drops). This bundle is what
 * higher-level helpers assemble before calling the pure chunker.
 */
export type ChunkerSources = {
  schema: NormalizedSchemaV2;
  /** Keyed by table id (`table:<schema>.<name>`). Missing when no `tables/<x>.md` exists. */
  tables: Record<string, ParsedTableMarkdown>;
  concepts?: ParsedConceptsMarkdown;
  tenantPolicy?: ParsedTenantPolicyMarkdown;
};

/**
 * Load a v2 schema directory into the form the chunker expects.
 *
 * Directory layout matches the schema-v2 contract:
 *   `<schemaId>.schema/`
 *     `schema.json`
 *     `tables/*.md`
 *     `concepts.md` (optional)
 */
export function loadChunkerSourcesFromDir(dir: string): ChunkerSources {
  const resolved = resolve(dir);
  const schema = loadSchema(resolved);

  const tables: Record<string, ParsedTableMarkdown> = {};
  const tableDir = join(resolved, "tables");
  let entries: string[] = [];
  try {
    entries = readdirSync(tableDir).sort();
  } catch {
    entries = [];
  }
  for (const entry of entries) {
    if (!entry.endsWith(".md")) continue;
    const filePath = join(tableDir, entry);
    const content = readFileSync(filePath, "utf8");
    const parsed = parseTableMarkdown(content, filePath);
    tables[parsed.frontmatter.id] = parsed;
  }

  let concepts: ParsedConceptsMarkdown | undefined;
  try {
    const conceptsPath = join(resolved, "concepts.md");
    const content = readFileSync(conceptsPath, "utf8");
    concepts = parseConceptsMarkdown(content, conceptsPath);
  } catch {
    // optional
  }

  let tenantPolicy: ParsedTenantPolicyMarkdown | undefined;
  try {
    const tenantPolicyPath = join(resolved, "tenant-policy.md");
    const content = readFileSync(tenantPolicyPath, "utf8");
    tenantPolicy = parseTenantPolicyMarkdown(content);
  } catch {
    // optional
  }

  return { schema, tables, concepts, tenantPolicy };
}

/**
 * Load a v2 bundle (`*.bundle.json` produced by `askdb bundle`) into the
 * chunker's source shape. Bundles preserve the raw markdown bodies under
 * `tables: { filename: content }` so the chunker can re-parse them.
 */
export function loadChunkerSourcesFromBundleJson(raw: string): ChunkerSources {
  const parsed = JSON.parse(raw) as {
    bundled?: boolean;
    physical?: unknown;
    tables?: Record<string, string>;
    concepts?: string;
    tenantPolicy?: string;
  };
  if (!parsed.bundled) {
    throw new Error("Expected a bundled schema JSON (missing `bundled: true`).");
  }
  const schema = loadSchemaFromJson(raw);

  const tables: Record<string, ParsedTableMarkdown> = {};
  const filenames = Object.keys(parsed.tables ?? {}).sort();
  for (const filename of filenames) {
    const content = parsed.tables![filename];
    const parsedMd = parseTableMarkdown(content, filename);
    tables[parsedMd.frontmatter.id] = parsedMd;
  }

  let concepts: ParsedConceptsMarkdown | undefined;
  if (parsed.concepts) {
    concepts = parseConceptsMarkdown(parsed.concepts, "concepts.md");
  }

  let tenantPolicy: ParsedTenantPolicyMarkdown | undefined;
  if (parsed.tenantPolicy) {
    tenantPolicy = parseTenantPolicyMarkdown(parsed.tenantPolicy);
  }

  return { schema, tables, concepts, tenantPolicy };
}
