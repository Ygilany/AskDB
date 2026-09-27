/**
 * Dialects `pnpm lab ask` runs: every engine the fixture has. The fixture's engine
 * names are AskDB's built-in dialect ids.
 */
import { DIALECTS, type Dialect } from "./fixture.js";

export const SUPPORTED_DIALECTS = DIALECTS;
export type SupportedDialect = Dialect;

export function isSupportedDialect(value: string): value is SupportedDialect {
  return (SUPPORTED_DIALECTS as readonly string[]).includes(value);
}
