import matter from "gray-matter";
import { SchemaParseError } from "../../errors.js";
import {
  tenantPolicyFrontmatterSchema,
  TENANT_POLICY_H2_SECTIONS,
  type ParsedTenantPolicyMarkdown,
  type TenantPolicyFrontmatter,
  type TenantPolicyH2Section,
  type NormalizedTenantPolicy,
  type TenantPolicyWarning,
  type TableCoverageEntry,
  type TableTenantClassification,
  type ScopeThrough,
} from "./tenant-policy.js";

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

export function parseTenantPolicyMarkdown(
  content: string,
  filePath?: string,
): ParsedTenantPolicyMarkdown {
  const file = matter(content);
  const result = tenantPolicyFrontmatterSchema.safeParse(file.data);
  if (!result.success) {
    const loc = filePath ? ` in ${filePath}` : "";
    throw new SchemaParseError(
      `Invalid tenant-policy front-matter${loc}: ${result.error.message}`,
      result.error,
    );
  }

  const body = file.content;
  const sections = extractTenantPolicySections(body);

  return { frontmatter: result.data, body, sections };
}

function extractTenantPolicySections(
  body: string,
): Partial<Record<TenantPolicyH2Section, string>> {
  const sections: Partial<Record<TenantPolicyH2Section, string>> = {};
  const parts = body.split(/^## /m);
  for (const part of parts.slice(1)) {
    const newline = part.indexOf("\n");
    const heading = (newline === -1 ? part : part.slice(0, newline)).trim();
    const sectionBody = newline === -1 ? "" : part.slice(newline + 1);
    const matched = TENANT_POLICY_H2_SECTIONS.find(
      (s) => s.toLowerCase() === heading.toLowerCase(),
    );
    if (matched) {
      sections[matched] = sectionBody;
    }
  }
  return sections;
}

// ---------------------------------------------------------------------------
// Cross-reference validation & normalization
// ---------------------------------------------------------------------------

export function normalizeTenantPolicy(
  parsed: ParsedTenantPolicyMarkdown,
  physicalTableIds: Set<string>,
  physicalColumnIds: Set<string>,
): NormalizedTenantPolicy {
  const fm = parsed.frontmatter;
  const warnings: TenantPolicyWarning[] = [];

  const rootIds = new Set(fm.roots.map((r) => r.id));

  // Validate root table IDs exist in physical schema
  for (const root of fm.roots) {
    if (!physicalTableIds.has(root.id)) {
      warnings.push({ kind: "orphaned_root_id", id: root.id });
    }
    if (!physicalColumnIds.has(root.tenantIdColumn)) {
      warnings.push({
        kind: "orphaned_column_id",
        id: root.tenantIdColumn,
        context: `root ${root.id}`,
      });
    }
    if (root.parent) {
      if (!rootIds.has(root.parent.root)) {
        warnings.push({
          kind: "unknown_root_in_hierarchy",
          id: root.parent.root,
          context: `parent of root ${root.id}`,
        });
      }
      if (!physicalColumnIds.has(root.parent.foreignKey)) {
        warnings.push({
          kind: "orphaned_fk_id",
          id: root.parent.foreignKey,
          context: `parent FK on root ${root.id}`,
        });
      }
    }
  }

  // Validate hierarchy edges
  for (const edge of fm.hierarchy ?? []) {
    if (!rootIds.has(edge.parent)) {
      warnings.push({
        kind: "unknown_root_in_hierarchy",
        id: edge.parent,
        context: `hierarchy parent`,
      });
    }
    if (!rootIds.has(edge.child)) {
      warnings.push({
        kind: "unknown_root_in_hierarchy",
        id: edge.child,
        context: `hierarchy child`,
      });
    }
    if (!physicalColumnIds.has(edge.foreignKey)) {
      warnings.push({
        kind: "orphaned_fk_id",
        id: edge.foreignKey,
        context: `hierarchy edge ${edge.parent} -> ${edge.child}`,
      });
    }
  }

  // Detect hierarchy cycles
  const cycleIds = detectHierarchyCycles(fm);
  if (cycleIds.length > 0) {
    warnings.push({ kind: "hierarchy_cycle", ids: cycleIds });
  }

  // Validate scoped tables
  for (const st of fm.scopedTables ?? []) {
    if (!physicalTableIds.has(st.id)) {
      warnings.push({ kind: "orphaned_scoped_table_id", id: st.id });
    }
    for (const path of st.scopeThrough) {
      if (!rootIds.has(path.root)) {
        warnings.push({
          kind: "unknown_root_in_scope",
          id: path.root,
          context: `scopeThrough on ${st.id}`,
        });
      }
      if ("column" in path) {
        if (!physicalColumnIds.has(path.column)) {
          warnings.push({
            kind: "orphaned_column_id",
            id: path.column,
            context: `scopeThrough column on ${st.id}`,
          });
        }
      } else {
        for (const step of path.join) {
          if (!physicalColumnIds.has(step.from)) {
            warnings.push({
              kind: "orphaned_fk_id",
              id: step.from,
              context: `scopeThrough join on ${st.id}`,
            });
          }
          if (!physicalColumnIds.has(step.to)) {
            warnings.push({
              kind: "orphaned_fk_id",
              id: step.to,
              context: `scopeThrough join on ${st.id}`,
            });
          }
        }
      }
    }
  }

  // Validate polymorphic tables
  for (const pt of fm.polymorphicTables ?? []) {
    if (!physicalTableIds.has(pt.id)) {
      warnings.push({ kind: "orphaned_polymorphic_table_id", id: pt.id });
    }
    if (!physicalColumnIds.has(pt.typeColumn)) {
      warnings.push({
        kind: "orphaned_column_id",
        id: pt.typeColumn,
        context: `polymorphic typeColumn on ${pt.id}`,
      });
    }
    if (!physicalColumnIds.has(pt.idColumn)) {
      warnings.push({
        kind: "orphaned_column_id",
        id: pt.idColumn,
        context: `polymorphic idColumn on ${pt.id}`,
      });
    }
    for (const [typeVal, targetRoot] of Object.entries(pt.mapping)) {
      if (!rootIds.has(targetRoot)) {
        warnings.push({
          kind: "unknown_root_in_mapping",
          id: targetRoot,
          context: `polymorphic mapping '${typeVal}' on ${pt.id}`,
        });
      }
    }
  }

  // Validate global tables
  for (const gt of fm.globalTables ?? []) {
    if (!physicalTableIds.has(gt)) {
      warnings.push({ kind: "orphaned_global_table_id", id: gt });
    }
  }

  // Build coverage report
  const coverage = buildCoverage(fm, physicalTableIds);

  return {
    schemaId: fm.schemaId,
    enforcement: fm.enforcement,
    roots: fm.roots,
    hierarchy: fm.hierarchy ?? [],
    scopedTables: fm.scopedTables ?? [],
    polymorphicTables: fm.polymorphicTables ?? [],
    globalTables: fm.globalTables ?? [],
    coverage,
    warnings,
    body: parsed.body,
    sections: parsed.sections,
  };
}

// ---------------------------------------------------------------------------
// Coverage report
// ---------------------------------------------------------------------------

function buildCoverage(
  fm: TenantPolicyFrontmatter,
  physicalTableIds: Set<string>,
): TableCoverageEntry[] {
  const classified = new Map<string, { classification: TableTenantClassification; scopeRoots?: string[] }>();

  // Root tables
  for (const root of fm.roots) {
    classified.set(root.id, { classification: "root" });
  }

  // Scoped tables
  for (const st of fm.scopedTables ?? []) {
    const scopeRoots = st.scopeThrough.map((s) => s.root);
    const hasJoin = st.scopeThrough.some((s) => "join" in s);
    const classification: TableTenantClassification = hasJoin ? "inherited" : "scoped";
    classified.set(st.id, { classification, scopeRoots });
  }

  // Polymorphic tables
  for (const pt of fm.polymorphicTables ?? []) {
    const scopeRoots = Object.values(pt.mapping);
    classified.set(pt.id, { classification: "polymorphic", scopeRoots });
  }

  // Global tables
  for (const gt of fm.globalTables ?? []) {
    classified.set(gt, { classification: "global" });
  }

  // Build entries for all physical tables
  const entries: TableCoverageEntry[] = [];
  for (const tableId of physicalTableIds) {
    const info = classified.get(tableId);
    if (info) {
      entries.push({ tableId, classification: info.classification, scopeRoots: info.scopeRoots });
    } else {
      entries.push({ tableId, classification: "unknown" });
    }
  }

  // Sort for determinism
  entries.sort((a, b) => a.tableId.localeCompare(b.tableId));

  return entries;
}

// ---------------------------------------------------------------------------
// Helpers — scope-through classification for mixed tables
// ---------------------------------------------------------------------------

export function isScopeThroughColumn(s: ScopeThrough): s is ScopeThrough & { column: string } {
  return "column" in s;
}

export function isScopeThroughJoin(s: ScopeThrough): s is ScopeThrough & { join: Array<{ from: string; to: string }> } {
  return "join" in s;
}

// ---------------------------------------------------------------------------
// Cycle detection in hierarchy
// ---------------------------------------------------------------------------

function detectHierarchyCycles(fm: TenantPolicyFrontmatter): string[] {
  const parentMap = new Map<string, string>();

  for (const root of fm.roots) {
    if (root.parent) {
      parentMap.set(root.id, root.parent.root);
    }
  }

  // Also use hierarchy edges
  for (const edge of fm.hierarchy ?? []) {
    parentMap.set(edge.child, edge.parent);
  }

  // Walk each node up — if we revisit a node, there's a cycle
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const cycleNodes: string[] = [];

  for (const node of parentMap.keys()) {
    if (visited.has(node)) continue;
    const path: string[] = [];
    let current: string | undefined = node;
    while (current && !visited.has(current)) {
      if (inStack.has(current)) {
        // Found a cycle — collect the cycle nodes
        const cycleStart = path.indexOf(current);
        if (cycleStart !== -1) {
          cycleNodes.push(...path.slice(cycleStart));
        }
        break;
      }
      inStack.add(current);
      path.push(current);
      current = parentMap.get(current);
    }
    for (const n of path) {
      visited.add(n);
      inStack.delete(n);
    }
  }

  return [...new Set(cycleNodes)];
}
