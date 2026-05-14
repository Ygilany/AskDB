import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * When multiple config files exist, the first extension in this list wins
 * (per-family: `askdb.config.*` vs `.config/askdb.*`).
 */
export const ASKDB_CONFIG_EXTENSION_PRECEDENCE = ["ts", "mts", "cts", "js", "mjs", "cjs"] as const;

export type AskDbConfigExtension = (typeof ASKDB_CONFIG_EXTENSION_PRECEDENCE)[number];

/**
 * Resolve the path to an AskDB config file in `cwd`, or `undefined` if none exists.
 *
 * Discovery order:
 * 1. `askdb.config.<ext>` in cwd (extension precedence: ts → mts → cts → js → mjs → cjs)
 * 2. `.config/askdb.<ext>` in cwd (same extension precedence)
 */
export function discoverAskDbConfigPath(cwd: string): string | undefined {
  const families = [
    (ext: AskDbConfigExtension) => join(cwd, `askdb.config.${ext}`),
    (ext: AskDbConfigExtension) => join(cwd, ".config", `askdb.${ext}`),
  ] as const;

  for (const makePath of families) {
    for (const ext of ASKDB_CONFIG_EXTENSION_PRECEDENCE) {
      const candidate = makePath(ext);
      if (existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}
