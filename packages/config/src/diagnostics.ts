/**
 * Whether the `ASKDB_DEBUG` shell variable asks first-party binaries for debug diagnostics,
 * such as the stack trace of an unexpected error.
 *
 * Reads `process.env` directly rather than the runtime snapshot, because it must work when
 * `askdb.config.*` is missing or fails to load. Only `1` or `true` (case-insensitive) turn it on;
 * `0`, `false`, and any other value leave it off.
 */
export function isAskDbDebugEnabled(): boolean {
  const raw = process.env.ASKDB_DEBUG?.trim().toLowerCase();
  return raw === "1" || raw === "true";
}
