import { TenantScopeError } from "../errors.js";
import type { NormalizedTenantPolicy, TenantAccess, TenantScope } from "../schema/v2/tenant-policy.js";
import { subtreeRootIds } from "./tenant-hierarchy.js";
import { validateTenantScope } from "./tenant-scope-validate.js";

/**
 * A subtree's IDs grouped by tenant root: each key is a root table id from the
 * tenant policy (`"table:public.clients"`), and its value holds IDs of that root's
 * own `tenantIdColumn`, never IDs of another root.
 *
 * Root tables have separate ID spaces, so client `5` and agency `5` are different
 * tenants. Keying the IDs by root lets `ask()` bind each root's IDs to that root's
 * own `:tenant_<label>_ids` placeholder.
 */
export type TenantIdsByRoot = Readonly<Record<string, readonly string[]>>;

/**
 * Host callback that expands a `subtree` tenant scope. Given the tenant root id and
 * the seed IDs, return the subtree's IDs grouped by root ({@link TenantIdsByRoot}):
 *
 * - under `tenantRoot`: the seeds and any same-table descendants (e.g. child
 *   agencies through `agencies.parent_agency_id`);
 * - under each descendant root the policy declares (`roots[].parent` or
 *   `hierarchy[]`): that root's IDs in the subtree.
 *
 * Pass it to `ask()` as `resolveTenantDescendants`, or to {@link expandTenantScope}.
 */
export type ResolveTenantDescendants = (
  tenantRoot: string,
  seedIds: readonly string[],
) => Promise<TenantIdsByRoot> | TenantIdsByRoot;

/**
 * Replace a `subtree` access with the per-root access it expands to: `multi_root`
 * with one entry per root the subtree covers (the scope's root first, then its
 * descendant roots breadth-first), including a level with no IDs (`ids: []`), or `ids`
 * when the subtree is the scope's root alone. Other access kinds pass through untouched.
 *
 * Each root's IDs stay under that root, so they bind only to its own placeholder:
 * root tables have separate ID spaces, and folding a client ID into the agency
 * placeholder would match another agency (#338). This relies on every root deriving a distinct
 * placeholder, which `validateTenantScope()` and the policy loader enforce. The seeds are unioned into the
 * `tenantRoot` entry here, not trusted to the resolver, so an ancestor never loses
 * its own rows when a host returns strict descendants only.
 *
 * `ask()` runs this before generation, and a host runs it before a synchronous
 * `bindPreparedQuery()` (`askdb.bind()` does it for you), so there is one expansion (ADR 0014).
 * The scope is validated first (`validateTenantScope`), so an unknown root fails as in `ask()`.
 *
 * Fails closed with `SUBTREE_NOT_RESOLVABLE`: no resolver; a result that is an
 * array (the old flat shape) or not a plain object; a key that isn't a root in
 * this subtree; a value that isn't an array of non-empty strings; or no IDs at all.
 */
export async function expandTenantScope(
  policy: NormalizedTenantPolicy,
  scope: TenantScope,
  resolve: ResolveTenantDescendants | undefined,
): Promise<TenantScope> {
  validateTenantScope(policy, scope);
  const access = scope.access;
  if (access.kind !== "subtree") return scope;
  const { tenantRoot, rootIds } = access;
  const levels = subtreeRootIds(policy, tenantRoot);
  const shape = `{ ${levels.map((root) => `"${root}": [...]`).join(", ")} }`;
  const fail = (message: string) => new TenantScopeError(message, "SUBTREE_NOT_RESOLVABLE");

  if (!resolve) {
    throw fail(
      `tenantScope.access is a 'subtree' of '${tenantRoot}', but no ` +
        "resolveTenantDescendants was passed. AskDB does not query your database " +
        "to find descendants: pass resolveTenantDescendants to expand the seed IDs, or pass " +
        "an 'ids' or 'multi_root' access with each root's IDs already expanded.",
    );
  }

  const result: unknown = await resolve(tenantRoot, rootIds);
  if (Array.isArray(result)) {
    throw fail(
      `resolveTenantDescendants for '${tenantRoot}' returned an array. It must return IDs per ` +
        `tenant root, keyed by root table id: ${shape}. Root tables have separate ID spaces, so ` +
        "a flat list can't say which root each ID belongs to, and binding them all to " +
        `'${tenantRoot}' would match other tenants. Put the seeds and any same-table ` +
        `descendants under '${tenantRoot}', and each descendant root's IDs under that root.`,
    );
  }
  if (!isPlainObject(result)) {
    throw fail(
      `resolveTenantDescendants for '${tenantRoot}' must return an object mapping each ` +
        `tenant root in the subtree to its IDs: ${shape}.`,
    );
  }

  // Read the result exactly once: validate and build from this snapshot, so a getter
  // can't return one value to validation and another to the scope, and a property
  // validation can't see (non-enumerable) is never read at all.
  const idsByRoot = new Map<string, readonly string[]>();
  const knownRoots = new Set(policy.roots.map((root) => root.id));
  let returned = 0;
  for (const [root, value] of Object.entries(result)) {
    const ids: unknown = Array.isArray(value) ? [...value] : value;
    if (!knownRoots.has(root)) {
      throw fail(
        `resolveTenantDescendants returned IDs under a key the subtree can't have: '${root}' is ` +
          `not a tenant root in the policy. Allowed keys for a subtree of '${tenantRoot}': ` +
          `${levels.join(", ")}.`,
      );
    }
    if (!levels.includes(root)) {
      throw fail(
        `resolveTenantDescendants returned IDs under a key the subtree can't have: '${root}' is ` +
          `not in the subtree of '${tenantRoot}' (the policy's hierarchy doesn't reach it from ` +
          `there). Allowed keys: ${levels.join(", ")}.`,
      );
    }
    if (!isTenantIdArray(ids)) {
      throw fail(`resolveTenantDescendants: the IDs for '${root}' must be an array of non-empty strings.`);
    }
    idsByRoot.set(root, ids);
    returned += ids.length;
  }
  if (returned === 0) {
    throw fail(
      `resolveTenantDescendants returned no IDs for '${tenantRoot}' (seeds: ${rootIds.join(", ")}). ` +
        `Return at least the seeds under '${tenantRoot}'; refusing to build an empty tenant scope.`,
    );
  }

  // Every level the subtree covers stays in the scope, even one with no IDs. The
  // guardrail then checks a read of that root on its own placeholder, and binding that
  // placeholder fails closed (UNRESOLVED_TENANT_PLACEHOLDER). Dropping the level would
  // leave its rows readable through a parent's foreign key or an ancestor, which is
  // less restricted than a level the resolver narrowed to some IDs.
  const scopes = levels.map((root) => {
    const own = idsByRoot.get(root) ?? [];
    return { tenantRoot: root, ids: [...new Set(root === tenantRoot ? [...rootIds, ...own] : own)] };
  });
  const expanded: TenantAccess =
    scopes.length === 1 ? { kind: "ids", ...scopes[0]! } : { kind: "multi_root", scopes };
  return { ...scope, access: expanded };
}

function isTenantIdArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((id) => typeof id === "string" && id.length > 0);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
