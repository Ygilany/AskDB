/**
 * Prefer an explicitly `sql`-tagged fence; fall back to an untagged fence.
 * Never return a fence tagged with anything else (e.g. `json`, `sql-unbound`).
 * Keep single-block and bare-prose behavior identical to the pre-parameterize path.
 */
export function extractSqlFromModelText(raw: string): string {
  const text = raw.trim();
  const sqlTagged = /```sql(?![\w-])\s*([\s\S]*?)```/im.exec(text);
  if (sqlTagged?.[1]) {
    return sqlTagged[1].trim();
  }
  const untagged = /```(?![a-zA-Z])\s*([\s\S]*?)```/m.exec(text);
  if (untagged?.[1]) {
    return untagged[1].trim();
  }
  // A reply that only has non-sql tagged fences (json, sql-unbound, …) has no SQL.
  if (/```[a-zA-Z][\w-]*/.test(text)) {
    return "";
  }
  return text.trim();
}

/**
 * Extract the ```sql-unbound fence from model text, if present.
 * Returns undefined when the fence is missing or empty.
 */
export function extractUnboundSqlFromModelText(raw: string): string | undefined {
  const text = raw.trim();
  const fence = /```sql-unbound\s*([\s\S]*?)```/im.exec(text);
  if (fence?.[1]) {
    const unbound = fence[1].trim();
    return unbound.length > 0 ? unbound : undefined;
  }
  return undefined;
}
