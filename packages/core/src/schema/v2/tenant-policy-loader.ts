import { SchemaParseError } from "../../errors.js";
import { extractH2Sections, parseFrontMatter } from "./parser.js";
import {
  assertDistinctRootPlaceholders,
  formatTenantPolicyWarning,
  tenantPolicyFrontmatterSchema,
  TENANT_POLICY_H2_SECTIONS,
  type ParsedTenantPolicyMarkdown,
  type TenantPolicyFrontmatter,
  type NormalizedTenantPolicy,
  type TenantPolicyWarning,
  type TableCoverageEntry,
  type TableTenantClassification,
} from "./tenant-policy.js";

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

export function parseTenantPolicyMarkdown(
  content: string,
  filePath?: string,
): ParsedTenantPolicyMarkdown {
  // Malformed YAML must surface as SchemaParseError, never as a raw exception a
  // caller might treat as "no policy" — that would silently disable tenancy.
  const { frontmatter, body } = parseFrontMatter(
    content,
    "tenant-policy",
    tenantPolicyFrontmatterSchema,
    filePath,
  );
  return { frontmatter, body, sections: extractH2Sections(body, TENANT_POLICY_H2_SECTIONS) };
}

// ---------------------------------------------------------------------------
// Cross-reference validation & normalization
// ---------------------------------------------------------------------------

/** Problems that stay warnings in every mode: an entry for a table schema.json no longer has. */
const TABLE_REMOVED_KINDS: ReadonlySet<TenantPolicyWarning["kind"]> = new Set([
  "orphaned_root_id",
  "orphaned_scoped_table_id",
  "orphaned_polymorphic_table_id",
  "orphaned_global_table_id",
]);

/**
 * Check a parsed tenant policy against schema.json and normalize it. `physicalColumns` maps each
 * column ID in schema.json to its table's ID, read from schema.json rather than split from the
 * column ID, since a SQL Server table name can hold `#`.
 */
export function normalizeTenantPolicy(
  parsed: ParsedTenantPolicyMarkdown,
  physicalTableIds: Set<string>,
  physicalColumns: ReadonlyMap<string, string>,
): NormalizedTenantPolicy {
  const fm = parsed.frontmatter;
  const warnings: TenantPolicyWarning[] = [];
  // A column the contract puts on `table` (#836): missing from schema.json is `orphaned`; in
  // schema.json but on another table is `misplaced_column_id`.
  const checkColumnOn = (
    id: string,
    table: string,
    orphaned: "orphaned_column_id" | "orphaned_fk_id",
    context: string,
  ): void => {
    const actual = physicalColumns.get(id);
    if (actual === undefined) warnings.push({ kind: orphaned, id, context });
    else if (actual !== table) warnings.push({ kind: "misplaced_column_id", id, tableId: actual, context });
  };

  // A shared placeholder would bind one root's IDs where another root's column is compared.
  assertDistinctRootPlaceholders(fm.roots);

  const rootIds = new Set(fm.roots.map((r) => r.id));
  // An entry whose own table schema.json no longer has reports only that table: its
  // columns went with it, and the entry scopes nothing, so they are not checked.
  const tableRemoved = (tableId: string) => !physicalTableIds.has(tableId);

  // Validate root table IDs exist in physical schema
  for (const root of fm.roots) {
    if (tableRemoved(root.id)) {
      warnings.push({ kind: "orphaned_root_id", id: root.id });
    } else {
      checkColumnOn(root.tenantIdColumn, root.id, "orphaned_column_id", `root ${root.id}`);
    }
    if (root.parent) {
      if (!rootIds.has(root.parent.root)) {
        warnings.push({
          kind: "unknown_root_in_hierarchy",
          id: root.parent.root,
          context: `parent of root ${root.id}`,
        });
      }
      // The parent foreign key sits on this root's own table.
      if (!tableRemoved(root.id)) {
        checkColumnOn(root.parent.foreignKey, root.id, "orphaned_fk_id", `parent FK on root ${root.id}`);
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
    // The edge's foreign key sits on the child's table.
    if (!tableRemoved(edge.child)) {
      checkColumnOn(edge.foreignKey, edge.child, "orphaned_fk_id", `hierarchy edge ${edge.parent} -> ${edge.child}`);
    }
  }

  // Detect hierarchy cycles
  const cycleIds = detectHierarchyCycles(fm);
  if (cycleIds.length > 0) {
    warnings.push({ kind: "hierarchy_cycle", ids: cycleIds });
  }

  // Validate scoped tables
  for (const st of fm.scopedTables ?? []) {
    const removed = tableRemoved(st.id);
    if (removed) {
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
      if (removed) continue;
      if ("column" in path) {
        checkColumnOn(path.column, st.id, "orphaned_column_id", `scopeThrough column on ${st.id}`);
      } else {
        for (const step of path.join) {
          if (!physicalColumns.has(step.from)) {
            warnings.push({
              kind: "orphaned_fk_id",
              id: step.from,
              context: `scopeThrough join on ${st.id}`,
            });
          }
          if (!physicalColumns.has(step.to)) {
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
    const removed = tableRemoved(pt.id);
    if (removed) {
      warnings.push({ kind: "orphaned_polymorphic_table_id", id: pt.id });
    }
    if (!removed) {
      checkColumnOn(pt.typeColumn, pt.id, "orphaned_column_id", `polymorphic typeColumn on ${pt.id}`);
      checkColumnOn(pt.idColumn, pt.id, "orphaned_column_id", `polymorphic idColumn on ${pt.id}`);
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
    if (tableRemoved(gt)) {
      warnings.push({ kind: "orphaned_global_table_id", id: gt });
    }
  }

  // Under strict, a policy that doesn't match schema.json fails the load: tenancy
  // must not run on a policy with a renamed column or a cycle (ADR 0023). Only a
  // removed table's entry stays a warning, since it scopes nothing.
  if (fm.enforcement === "strict") {
    const errors = warnings.filter((w) => !TABLE_REMOVED_KINDS.has(w.kind));
    if (errors.length > 0) {
      throw new SchemaParseError(
        `the tenant policy doesn't match schema.json, and enforcement is strict: ` +
          `${errors.map(formatTenantPolicyWarning).join("; ")}. Update tenant-policy.md to match schema.json.`,
      );
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
// Cycle detection in hierarchy
// ---------------------------------------------------------------------------

function detectHierarchyCycles(fm: TenantPolicyFrontmatter): string[] {
  // Every parent of every child: the hierarchy is a DAG, so a root may have several
  // parents, and keeping one per child would hide a cycle behind a later edge.
  const parents = new Map<string, Set<string>>();
  const addEdge = (child: string, parent: string) => {
    const set = parents.get(child) ?? new Set<string>();
    set.add(parent);
    parents.set(child, set);
  };
  for (const root of fm.roots) {
    if (root.parent) addEdge(root.id, root.parent.root);
  }
  for (const edge of fm.hierarchy ?? []) addEdge(edge.child, edge.parent);

  // Depth-first walk up the parent edges; reaching a node still on the stack closes a cycle.
  const state = new Map<string, "open" | "done">();
  const stack: string[] = [];
  const cycleNodes: string[] = [];
  const visit = (node: string): void => {
    state.set(node, "open");
    stack.push(node);
    for (const parent of parents.get(node) ?? []) {
      const seen = state.get(parent);
      if (seen === "open") cycleNodes.push(...stack.slice(stack.indexOf(parent)));
      else if (seen === undefined) visit(parent);
    }
    stack.pop();
    state.set(node, "done");
  };
  for (const node of parents.keys()) {
    if (!state.has(node)) visit(node);
  }

  return [...new Set(cycleNodes)];
}
