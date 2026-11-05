import type { TenantSqlOutputMode } from "@askdb/core";
import type { AskResponse, PlaygroundHistoryEntry } from "../../shared/api";

/**
 * The Playground's starting tenant SQL mode: `DEFAULT_TENANT_SQL_MODE` from `@askdb/core`,
 * written out because the browser bundle imports only types from core.
 * `playground-tenant.test.ts` fails if the two drift.
 */
export const PLAYGROUND_DEFAULT_TENANT_SQL_MODE: TenantSqlOutputMode = "sql-params";

/**
 * The `tenant` part of a replayed history entry's result. A `sql-params` entry's SQL holds
 * driver markers, so Execute must send the tenant params it was saved with (keyed by their
 * 1-based marker position), in marker order. An entry saved without params has none.
 */
export function historyTenant(entry: Pick<PlaygroundHistoryEntry, "sqlMode" | "tenantParams">): AskResponse["tenant"] {
  const saved = entry.tenantParams;
  if (!saved) return null;
  const params = Object.entries(saved)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([, value]) => value);
  return { enabled: true, sqlMode: entry.sqlMode as TenantSqlOutputMode, bindings: [], params };
}
