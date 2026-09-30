import type { NormalizedTenantPolicy } from "../schema/v2/tenant-policy.js";
import type { TenantScope } from "../schema/v2/tenant-policy.js";
import { placeholderForTenantRoot } from "../schema/v2/tenant-policy.js";
import { unexpandedSubtreeError } from "./tenant-placeholders.js";

const NEVER_CROSS_ROOTS =
  "  The same ID value can name different tenants in different root tables: " +
  "never compare one root's placeholder with another root's column.";

/**
 * Build the tenant policy + runtime scope block for NL→SQL prompts.
 * This block is always injected when a tenant policy exists (security boundary).
 *
 * A `subtree` scope must be expanded into per-root IDs first (`ask()` does this
 * through `resolveTenantDescendants`); an unexpanded one throws
 * `SUBTREE_NOT_RESOLVABLE`.
 */
export function buildTenantPromptBlock(
  policy: NormalizedTenantPolicy,
  scope: TenantScope,
): string {
  const lines: string[] = [];

  lines.push("--- TENANT POLICY (mandatory — every tenant-scoped table MUST be filtered) ---");
  lines.push("");

  // Hierarchy
  lines.push("Tenant hierarchy:");
  for (const root of policy.roots) {
    const parentNote = root.parent
      ? ` (child of ${policy.roots.find((r) => r.id === root.parent!.root)?.label ?? root.parent.root})`
      : " (top-level)";
    lines.push(`  - ${root.label} [${root.id}]${parentNote}`);
  }
  lines.push("");

  // Scoped tables
  if (policy.scopedTables.length > 0) {
    lines.push("Tenant-scoped tables (MUST include tenant predicate):");
    for (const st of policy.scopedTables) {
      for (const path of st.scopeThrough) {
        const rootLabel = policy.roots.find((r) => r.id === path.root)?.label ?? path.root;
        if ("column" in path) {
          lines.push(`  - ${st.id} → filter via ${path.column} (${rootLabel} scope)`);
        } else {
          const joinPath = path.join.map((j) => `${j.from} → ${j.to}`).join(" → ");
          lines.push(`  - ${st.id} → join path: ${joinPath} (${rootLabel} scope)`);
        }
      }
    }
    lines.push("");
  }

  // Polymorphic tables
  if (policy.polymorphicTables.length > 0) {
    lines.push("Polymorphic tables (MUST include type discriminator AND id filter):");
    for (const pt of policy.polymorphicTables) {
      lines.push(`  - ${pt.id}: type column = ${pt.typeColumn}, id column = ${pt.idColumn}`);
      for (const [typeVal, targetRoot] of Object.entries(pt.mapping)) {
        const rootLabel = policy.roots.find((r) => r.id === targetRoot)?.label ?? targetRoot;
        lines.push(`    - '${typeVal}' → ${rootLabel}`);
      }
    }
    lines.push("");
  }

  // Global tables
  if (policy.globalTables.length > 0) {
    lines.push("Global tables (no tenant filter needed):");
    for (const gt of policy.globalTables) {
      lines.push(`  - ${gt}`);
    }
    lines.push("");
  }

  // Runtime scope
  lines.push("Current user scope:");
  const access = scope.access;
  switch (access.kind) {
    case "ids": {
      const rootLabel = policy.roots.find((r) => r.id === access.tenantRoot)?.label ?? access.tenantRoot;
      const placeholder = placeholderForTenantRoot({ id: access.tenantRoot, label: rootLabel });
      lines.push(`  Access: ${rootLabel} IDs = ${placeholder}`);
      // With several roots the model also sees other roots' columns (an expanded
      // subtree with IDs at its root only is an `ids` scope), so pair this one too.
      // A single-root policy keeps its block unchanged.
      const pairColumns = policy.roots.length > 1;
      if (pairColumns) {
        const columns = columnsHoldingRootIds(policy, access.tenantRoot);
        if (columns.length > 0) lines.push(`    columns: ${columns.join(", ")}`);
      }
      lines.push(`  Use ${placeholder} as the parameter placeholder for tenant predicates.`);
      if (pairColumns) lines.push(NEVER_CROSS_ROOTS);
      break;
    }
    case "subtree":
      throw unexpandedSubtreeError(access.tenantRoot, "buildTenantPromptBlock()");
    case "multi_root": {
      // Each root table has its own ID space (an expanded subtree is a multi_root
      // scope), so name the columns each placeholder may be compared with.
      lines.push(
        "  Access: multiple roots. Each placeholder holds the IDs of one tenant root; " +
          "compare it only with the columns listed under it:",
      );
      // The tenant guardrail checks every root the scope names as a root table (#341), so a
      // child root in the scope can't be filtered through its parent's foreign key: don't
      // offer that column under the parent's placeholder.
      const covered = new Set(access.scopes.map((s) => s.tenantRoot));
      for (const s of access.scopes) {
        const rootLabel = policy.roots.find((r) => r.id === s.tenantRoot)?.label ?? s.tenantRoot;
        // A level an expanded subtree covers with no IDs: its placeholder binds nothing.
        const empty = s.ids.length === 0 ? " (no IDs in this scope: don't read this table)" : "";
        lines.push(`    - ${rootLabel} IDs = ${placeholderForTenantRoot({ id: s.tenantRoot, label: rootLabel })}${empty}`);
        const columns = columnsHoldingRootIds(policy, s.tenantRoot, covered);
        if (columns.length > 0) lines.push(`      columns: ${columns.join(", ")}`);
      }
      lines.push(NEVER_CROSS_ROOTS);
      lines.push(
        "  A root table listed here that the query reads must itself be filtered with its own placeholder; " +
          "filtering it only through its parent's foreign key or a joined ancestor is not enough.",
      );
      break;
    }
    case "global":
      lines.push(`  Access: GLOBAL (reason: ${access.reason}) — no tenant filtering required`);
      break;
  }
  lines.push("");

  // Advisory context
  if (scope.context) {
    const ctx = scope.context;
    const parts: string[] = [];
    if (ctx.role) parts.push(`role: ${ctx.role}`);
    if (ctx.department) parts.push(`department: ${ctx.department}`);
    if (ctx.region) parts.push(`region: ${ctx.region}`);
    if (ctx.label) parts.push(`user: ${ctx.label}`);
    if (ctx.description) parts.push(ctx.description);
    if (ctx.attributes) {
      for (const [k, v] of Object.entries(ctx.attributes)) {
        parts.push(`${k}: ${v}`);
      }
    }
    if (parts.length > 0) {
      lines.push("User context (advisory — not enforced):");
      for (const part of parts) {
        lines.push(`  - ${part}`);
      }
      lines.push("");
    }
  }

  // Enforcement instructions
  lines.push("Enforcement rules:");
  lines.push("- Every query on a tenant-scoped table MUST include the tenant predicate.");
  lines.push("- Use named placeholders for tenant IDs (e.g., :tenant_agency_ids).");
  lines.push("- For inherited scope, JOIN through the specified path to reach the tenant root.");
  lines.push("- For polymorphic tables, always include the type discriminator column in WHERE.");
  lines.push("- Global/reference tables do NOT need tenant predicates.");
  if (scope.access.kind === "global") {
    lines.push("- GLOBAL scope is active — tenant predicates are optional for this query.");
  }
  lines.push("--- END TENANT POLICY ---");

  return lines.join("\n");
}

/**
 * The columns whose values are IDs of `rootId`, per the policy, in a stable order:
 * the root's own `tenantIdColumn`; each child root's foreign key to it
 * (`roots[].parent`, `hierarchy[]`), unless that child is in `coveredRoots` (the guardrail
 * checks a covered child on its own placeholder); each scoped table's direct column for it;
 * and each polymorphic ID column, with the discriminator value that points at it.
 * A table scoped through a join path is filtered on the root's own column after
 * the join, as the join-path lines of the prompt say, so it adds no column here.
 */
function columnsHoldingRootIds(
  policy: NormalizedTenantPolicy,
  rootId: string,
  coveredRoots: ReadonlySet<string> = new Set(),
): string[] {
  const root = policy.roots.find((r) => r.id === rootId);
  const columns: string[] = [];
  const add = (column: string) => {
    if (!columns.includes(column)) columns.push(column);
  };
  if (root) add(root.tenantIdColumn);
  for (const child of policy.roots) {
    if (child.parent?.root === rootId && !coveredRoots.has(child.id)) add(child.parent.foreignKey);
  }
  for (const edge of policy.hierarchy) {
    if (edge.parent === rootId && !coveredRoots.has(edge.child)) add(edge.foreignKey);
  }
  for (const st of policy.scopedTables) {
    for (const path of st.scopeThrough) {
      if (path.root === rootId && "column" in path) add(path.column);
    }
  }
  for (const pt of policy.polymorphicTables) {
    for (const [typeValue, target] of Object.entries(pt.mapping)) {
      if (target === rootId) add(`${pt.idColumn} (where ${pt.typeColumn} = '${typeValue}')`);
    }
  }
  return columns;
}
