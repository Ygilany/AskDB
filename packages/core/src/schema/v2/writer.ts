import matter from "gray-matter";
import type { V2TableFrontmatter, V2ConceptsFrontmatter } from "./describable.js";
import type { TenantPolicyFrontmatter } from "./tenant-policy.js";

/**
 * Serialize a table front-matter model back to markdown.
 *
 * - Front-matter keys are emitted in a stable order.
 * - The markdown body is preserved verbatim from the parsed input.
 * - Round-trip property: `parse(write(parse(file)))` equals `parse(file)` for structured fields.
 */
export function writeTableMarkdown(frontmatter: V2TableFrontmatter, body: string): string {
  const data = orderedTableFrontmatter(frontmatter);
  return matter.stringify(body, data);
}

/**
 * Serialize `concepts.md` front-matter + body back to markdown.
 */
export function writeConceptsMarkdown(frontmatter: V2ConceptsFrontmatter, body: string): string {
  return matter.stringify(body, { concepts: frontmatter.concepts });
}

/**
 * Serialize `tenant-policy.md` front-matter + body back to markdown.
 */
export function writeTenantPolicyMarkdown(frontmatter: TenantPolicyFrontmatter, body: string): string {
  const data = orderedTenantPolicyFrontmatter(frontmatter);
  return matter.stringify(body, data);
}

/** Emit tenant policy front-matter keys in a stable order. */
function orderedTenantPolicyFrontmatter(fm: TenantPolicyFrontmatter): Record<string, unknown> {
  const ordered: Record<string, unknown> = {};
  ordered["schemaId"] = fm.schemaId;
  ordered["enforcement"] = fm.enforcement;
  ordered["roots"] = fm.roots.map((r) => {
    const root: Record<string, unknown> = {
      id: r.id,
      tenantIdColumn: r.tenantIdColumn,
      label: r.label,
    };
    if (r.parent) root["parent"] = r.parent;
    return root;
  });
  if (fm.hierarchy && fm.hierarchy.length > 0) ordered["hierarchy"] = fm.hierarchy;
  if (fm.scopedTables && fm.scopedTables.length > 0) ordered["scopedTables"] = fm.scopedTables;
  if (fm.polymorphicTables && fm.polymorphicTables.length > 0) ordered["polymorphicTables"] = fm.polymorphicTables;
  if (fm.globalTables && fm.globalTables.length > 0) ordered["globalTables"] = fm.globalTables;
  return ordered;
}

/** Emit front-matter keys in a stable, spec-defined order. */
function orderedTableFrontmatter(fm: V2TableFrontmatter): Record<string, unknown> {
  const ordered: Record<string, unknown> = {};
  ordered["id"] = fm.id;
  ordered["name"] = fm.name;
  ordered["schemaId"] = fm.schemaId;
  if (fm.primaryEntity !== undefined) ordered["primaryEntity"] = fm.primaryEntity;
  if (fm.aliases !== undefined) ordered["aliases"] = fm.aliases;
  if (fm.tags !== undefined) ordered["tags"] = fm.tags;
  if (fm.sensitive !== undefined) ordered["sensitive"] = fm.sensitive;
  if (fm.tracked !== undefined) ordered["tracked"] = fm.tracked;
  if (fm.columns !== undefined) {
    ordered["columns"] = fm.columns.map((c) => {
      const col: Record<string, unknown> = { id: c.id };
      if (c.aliases !== undefined) col["aliases"] = c.aliases;
      if (c.enum !== undefined) col["enum"] = c.enum;
      if (c.description !== undefined) col["description"] = c.description;
      if (c.sensitive !== undefined) col["sensitive"] = c.sensitive;
      return col;
    });
  }
  return ordered;
}
