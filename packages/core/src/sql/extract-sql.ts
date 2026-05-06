/**
 * Prefer fenced ```sql blocks; otherwise use trimmed prose if it resembles a single SELECT.
 */
export function extractSqlFromModelText(raw: string): string {
  const text = raw.trim();
  const fence = /```(?:sql)?\s*([\s\S]*?)```/im.exec(text);
  if (fence?.[1]) {
    return fence[1].trim();
  }
  return text.trim();
}
