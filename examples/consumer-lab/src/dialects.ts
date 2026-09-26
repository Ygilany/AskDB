/**
 * Dialects `pnpm lab ask` can run today. The fixture has all five; the lab gains the
 * others with the replay model (#243).
 */
export const SUPPORTED_DIALECTS = ["postgres"] as const;
export type SupportedDialect = (typeof SUPPORTED_DIALECTS)[number];

export function isSupportedDialect(value: string): value is SupportedDialect {
  return (SUPPORTED_DIALECTS as readonly string[]).includes(value);
}
