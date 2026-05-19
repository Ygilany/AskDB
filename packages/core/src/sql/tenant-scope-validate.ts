import { TenantScopeError } from "../errors.js";
import type { NormalizedTenantPolicy } from "../schema/v2/tenant-policy.js";
import { tenantScopeSchema, type TenantScope } from "../schema/v2/tenant-policy.js";

/**
 * Validate a `TenantScope` input against a tenant policy before prompt generation.
 * Throws `TenantScopeError` on failure.
 */
export function validateTenantScope(
  tenantPolicy: NormalizedTenantPolicy,
  tenantScope: TenantScope | undefined,
): void {
  // Fail closed: policy exists but no scope
  if (!tenantScope) {
    throw new TenantScopeError(
      "Tenant policy is active but no tenantScope was provided. " +
        "Pass a TenantScope to ask() or remove tenant-policy.md to disable enforcement.",
      "MISSING_SCOPE",
    );
  }

  // Validate shape with zod
  const parsed = tenantScopeSchema.safeParse(tenantScope);
  if (!parsed.success) {
    throw new TenantScopeError(
      `Invalid tenantScope shape: ${parsed.error.message}`,
      "INVALID_SCOPE_SHAPE",
    );
  }

  const rootIds = new Set(tenantPolicy.roots.map((r) => r.id));
  const access = tenantScope.access;

  switch (access.kind) {
    case "ids":
      if (!rootIds.has(access.tenantRoot)) {
        throw new TenantScopeError(
          `tenantScope.access references unknown tenant root '${access.tenantRoot}'. ` +
            `Known roots: ${[...rootIds].join(", ")}`,
          "UNKNOWN_TENANT_ROOT",
        );
      }
      break;

    case "subtree":
      if (!rootIds.has(access.tenantRoot)) {
        throw new TenantScopeError(
          `tenantScope.access references unknown tenant root '${access.tenantRoot}'. ` +
            `Known roots: ${[...rootIds].join(", ")}`,
          "UNKNOWN_TENANT_ROOT",
        );
      }
      break;

    case "multi_root":
      for (const scope of access.scopes) {
        if (!rootIds.has(scope.tenantRoot)) {
          throw new TenantScopeError(
            `tenantScope.access.scopes references unknown tenant root '${scope.tenantRoot}'. ` +
              `Known roots: ${[...rootIds].join(", ")}`,
            "UNKNOWN_TENANT_ROOT",
          );
        }
      }
      break;

    case "global":
      // reason is already validated as non-empty by zod
      break;
  }
}
