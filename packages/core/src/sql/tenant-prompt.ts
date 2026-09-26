import type { NormalizedTenantPolicy } from "../schema/v2/tenant-policy.js";
import type { TenantScope } from "../schema/v2/tenant-policy.js";

/**
 * Build the tenant policy + runtime scope block for NL→SQL prompts.
 * This block is always injected when a tenant policy exists (security boundary).
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
      const placeholder = `:tenant_${rootLabel.toLowerCase().replace(/[^a-z0-9]+/g, "_")}_ids`;
      lines.push(`  Access: ${rootLabel} IDs = ${placeholder}`);
      lines.push(`  Use ${placeholder} as the parameter placeholder for tenant predicates.`);
      break;
    }
    case "subtree": {
      const rootLabel = policy.roots.find((r) => r.id === access.tenantRoot)?.label ?? access.tenantRoot;
      const placeholder = `:tenant_${rootLabel.toLowerCase().replace(/[^a-z0-9]+/g, "_")}_ids`;
      lines.push(`  Access: ${rootLabel} subtree from IDs = ${placeholder} (include all descendants)`);
      lines.push(`  Use ${placeholder} as the parameter placeholder for tenant predicates.`);
      break;
    }
    case "multi_root": {
      lines.push("  Access: multiple roots —");
      for (const s of access.scopes) {
        const rootLabel = policy.roots.find((r) => r.id === s.tenantRoot)?.label ?? s.tenantRoot;
        const placeholder = `:tenant_${rootLabel.toLowerCase().replace(/[^a-z0-9]+/g, "_")}_ids`;
        lines.push(`    - ${rootLabel} IDs = ${placeholder}`);
      }
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
