/**
 * Dialects `pnpm lab ask` can run in this PR: Postgres only, as the tracer bullet that
 * proves pack → install → `ask()` → execute on one engine. This is temporary. The next
 * PR in the stack (#271, the replay model, #243) adds host execution and cassettes for
 * the other engines and widens this to all five the fixture has.
 */
export const SUPPORTED_DIALECTS = ["postgres"] as const;
export type SupportedDialect = (typeof SUPPORTED_DIALECTS)[number];

export function isSupportedDialect(value: string): value is SupportedDialect {
  return (SUPPORTED_DIALECTS as readonly string[]).includes(value);
}
