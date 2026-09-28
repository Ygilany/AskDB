/**
 * The tenant policy overlay (`scenarios/overlay/tenant-policy.md`) applied to the fixture's
 * schema artifacts, and the host side of a tenant-scoped `ask()`: the scope, and the
 * `resolveTenantDescendants` callback that walks the agency tree on the engine.
 *
 * The overlay is written in the documented format (`docs/contracts/tenant-policy.md`), with
 * stable IDs from `schema.json`. It uses the logical IDs (`table:org.agency`); each is
 * mapped to the one table of that name in the dialect's artifact, because SQLite renders
 * every table under `public`. The copy goes to a fresh directory: the introspected
 * artifact itself stays policy-free for the other suites.
 */
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { TenantScope } from "@askdb/core";
import { ensureArtifact } from "./artifacts.js";
import type { SupportedDialect } from "./dialects.js";
import { physicalName } from "./fixture.js";
import { executeReadOnly } from "./host/execute.js";
import { LAB_ROOT, LAB_STATE } from "./paths.js";

export const TENANT_OVERLAY = join(LAB_ROOT, "scenarios", "overlay", "tenant-policy.md");

export type Enforcement = "strict" | "warn";

/**
 * The `resolveTenantDescendants` callback, as `docs/contracts/tenant-policy.md` ("Subtree
 * expansion") writes it. Declared here, not imported, so the lab still typechecks against
 * a target from before the option existed.
 */
export type ResolveTenantDescendants = (tenantRoot: string, seedIds: readonly string[]) => Promise<readonly string[]> | readonly string[];

/** The artifact's stable table IDs by table name. Table names are unique across the fixture's schemas. */
function tableIds(schemaDir: string): Map<string, string> {
  const { tables } = JSON.parse(readFileSync(join(schemaDir, "schema.json"), "utf8")) as { tables: { id: string; name: string }[] };
  return new Map(tables.map((t) => [t.name, t.id]));
}

/** The dialect's stable ID for a logical table ID (`table:org.agency` → `table:public.agency` on SQLite). */
function mapTableId(ids: Map<string, string>, logical: string): string {
  const name = logical.slice(logical.lastIndexOf(".") + 1);
  const id = ids.get(name);
  if (!id) throw new Error(`the tenant overlay names ${logical}, but the artifact has no table ${name}`);
  return id;
}

/**
 * A copy of the dialect's schema artifact with the tenant overlay applied, in a fresh
 * directory under `.lab/artifacts/tenant/`. `enforcement` replaces the overlay's own.
 */
export function tenantArtifact(dialect: SupportedDialect, enforcement: Enforcement = "strict"): string {
  const source = ensureArtifact(dialect);
  const ids = tableIds(source);
  mkdirSync(join(LAB_STATE, "artifacts", "tenant"), { recursive: true });
  const dir = join(mkdtempSync(join(LAB_STATE, "artifacts", "tenant", `${dialect}-${enforcement}-`)), "schema");
  cpSync(source, dir, { recursive: true });
  const policy = readFileSync(TENANT_OVERLAY, "utf8")
    .replace(/^enforcement: \w+$/m, `enforcement: ${enforcement}`)
    .replace(/\btable:[a-z_]+\.[a-z_]+/g, (logical) => mapTableId(ids, logical));
  writeFileSync(join(dir, "tenant-policy.md"), policy);
  return dir;
}

/** The overlay's one tenant root, `org.agency`, as the dialect's artifact names it. */
export function agencyRoot(dialect: SupportedDialect): string {
  return dialect === "sqlite" ? "table:public.agency" : "table:org.agency";
}

/** A flat scope: exactly these agencies (`access.kind: "ids"`). */
export function idsScope(dialect: SupportedDialect, ids: readonly number[]): TenantScope {
  return { access: { kind: "ids", tenantRoot: agencyRoot(dialect), ids: ids.map(String) } };
}

/** A hierarchical scope: these agencies and every descendant (`access.kind: "subtree"`). */
export function subtreeScope(dialect: SupportedDialect, rootIds: readonly number[]): TenantScope {
  return { access: { kind: "subtree", tenantRoot: agencyRoot(dialect), rootIds: rootIds.map(String), includeDescendants: true } };
}

/** The dialect's driver markers for `count` parameters, as `executeReadOnly` binds them. */
function markers(dialect: SupportedDialect, count: number): string {
  return Array.from({ length: count }, (_, i) => (dialect === "postgres" ? `$${i + 1}` : dialect === "sqlserver" ? `@p${i}` : "?")).join(", ");
}

/**
 * The lab's `resolveTenantDescendants`, as the multi-tenancy guide's host example writes one
 * ("Hierarchical scope (`subtree`)"): a recursive query over `org.agency.parent_agency_id`,
 * run on the dialect's engine as the read-only role. It returns the seeds and every
 * descendant, as strings. SQL Server spells a recursive CTE `WITH` (and needs `UNION ALL`);
 * the others take `WITH RECURSIVE`. The tree has no cycles, so `UNION ALL` is enough.
 *
 * `calls` records each call's arguments, so a test can tell the resolver was used.
 */
export function agencyDescendants(dialect: SupportedDialect): ResolveTenantDescendants & { calls: [string, string[]][] } {
  const calls: [string, string[]][] = [];
  const agency = physicalName(dialect, { schema: "org", name: "agency" });
  const resolve = async (tenantRoot: string, seedIds: readonly string[]): Promise<string[]> => {
    calls.push([tenantRoot, [...seedIds]]);
    if (tenantRoot !== agencyRoot(dialect)) throw new Error(`the lab has no hierarchy resolver for ${tenantRoot}`);
    const sql =
      `${dialect === "sqlserver" ? "WITH" : "WITH RECURSIVE"} tree (agency_id) AS (\n` +
      `  SELECT agency_id FROM ${agency} WHERE agency_id IN (${markers(dialect, seedIds.length)})\n` +
      `  UNION ALL\n` +
      `  SELECT a.agency_id FROM ${agency} a JOIN tree t ON a.parent_agency_id = t.agency_id\n` +
      `)\nSELECT agency_id FROM tree`;
    const result = await executeReadOnly(dialect, sql, { params: seedIds });
    if (result.truncated) throw new Error("the agency tree is larger than the host's row cap");
    return [...new Set(result.rows.map((row) => String(row[0])))];
  };
  return Object.assign(resolve, { calls });
}
