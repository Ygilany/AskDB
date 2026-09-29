/**
 * SQLite "connection strings" are file paths (or `:memory:`) and carry no
 * credentials, so they are returned unchanged. Exported for parity with the
 * other engine packages so hosts can dispatch redaction by provider.
 */
export function redactConnectionString(input: string): string {
  return input;
}
