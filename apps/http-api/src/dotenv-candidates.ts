import { resolve } from "node:path";

/**
 * The `.env` files `askdb-http` tries, in order: `bootstrapAskDbEnv` loads the first that exists.
 * The working directory's comes first. Then the package folder's and, when the binary runs from
 * AskDB's own repo (`apps/http-api/dist`), the repo root's, but never one inside `node_modules`:
 * in an install, those point into folders the host doesn't own or expect to hold settings (#839).
 *
 * @internal Exported for unit tests; not re-exported from the package entry point.
 */
export function dotenvCandidates(binDir: string, cwd: string): string[] {
  const fromBinary = [resolve(binDir, "../.env"), resolve(binDir, "../../../.env")].filter(
    (path) => !path.split(/[\\/]/).includes("node_modules"),
  );
  return [...new Set([resolve(cwd, ".env"), ...fromBinary])];
}
