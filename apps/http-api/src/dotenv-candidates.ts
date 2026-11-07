import { resolve } from "node:path";

/**
 * The `.env` files `askdb-http` tries, in order: `bootstrapAskDbEnv` loads the first that exists.
 * The working directory's comes first. Only when the binary runs from AskDB's own source checkout
 * (`fromSourceCheckout`: `apps/http-api/dist` beside its unpublished `src`) do the package folder's
 * and the repo root's follow, and never one inside `node_modules`: in an install, or a package
 * folder copied out of one, those point into folders the host doesn't own or expect to hold
 * settings (#839).
 *
 * @internal Exported for unit tests; not re-exported from the package entry point.
 */
export function dotenvCandidates(binDir: string, cwd: string, fromSourceCheckout: boolean): string[] {
  const fromBinary = fromSourceCheckout
    ? [resolve(binDir, "../.env"), resolve(binDir, "../../../.env")].filter(
        (path) => !path.split(/[\\/]/).includes("node_modules"),
      )
    : [];
  return [...new Set([resolve(cwd, ".env"), ...fromBinary])];
}
