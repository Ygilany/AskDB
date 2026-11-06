import type { AskDbLogger } from "../logging/askdb-logger.js";
import { AskDbLogEvent } from "../logging/log-events.js";
import type { NormalizedTenantPolicy } from "../schema/v2/tenant-policy.js";
import { formatTenantPolicyWarning } from "../schema/v2/tenant-policy.js";

/** Policies whose warnings were already logged. Each `loadSchema()` returns a new policy object. */
const logged = new WeakSet<NormalizedTenantPolicy>();

/**
 * Log a loaded tenant policy's warnings once per loaded schema (ADR 0023).
 * `loadSchema()` takes no logger, so the first `ask()` with a logger reports them.
 */
export function logTenantPolicyWarningsOnce(
  logger: AskDbLogger | undefined,
  policy: NormalizedTenantPolicy,
): void {
  if (!logger || policy.warnings.length === 0 || logged.has(policy)) return;
  logged.add(policy);
  const log = logger.warn ?? logger.info;
  log.call(
    logger,
    {
      event: AskDbLogEvent.TenantPolicyWarnings,
      enforcement: policy.enforcement,
      warningCount: policy.warnings.length,
      warnings: policy.warnings,
    },
    `tenant policy doesn't match schema.json: ${policy.warnings.map(formatTenantPolicyWarning).join("; ")}`,
  );
}
