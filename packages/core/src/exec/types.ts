/**
 * Canonical row shape returned by every `AskDbExecutor` (built-in and BYO).
 *
 * Lives in its own module so the executor seam contract types (`AskDbExecutor`, `TabularResult`)
 * are reachable from `@askdb/core` without dragging in any code that statically references
 * the optional `pg` peer dependency.
 *
 * Stable as part of the published `@askdb/core` contract — see
 * `docs/specs/phase-4-publish-npm/requirements.md` ("Executor seam — contract").
 */
export type TabularResult = {
  columns: string[];
  rows: unknown[][];
};
