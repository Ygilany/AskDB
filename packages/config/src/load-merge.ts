import { createJiti } from "jiti";
import { pathToFileURL } from "node:url";
import { discoverAskDbConfigPath } from "./discover.js";
import { isAskDbEnvProjection, type AskDbEnvProjection } from "./projection.js";

async function importConfigModule(configPath: string): Promise<unknown> {
  const lower = configPath.toLowerCase();
  if (lower.endsWith(".mjs")) {
    const href = pathToFileURL(configPath).href;
    const mod = await import(href);
    return mod.default ?? mod;
  }

  const jiti = createJiti(configPath, { interopDefault: true });
  const mod = jiti(configPath) as { default?: unknown };
  return mod.default ?? mod;
}

function assertAskDbProjection(exported: unknown, configPath: string): AskDbEnvProjection {
  if (!isAskDbEnvProjection(exported)) {
    throw new Error(
      `AskDB config at ${configPath} must export default defineConfig({ ... }) from "@askdb/config". ` +
        `Legacy flat maps are no longer supported.`,
    );
  }
  return exported;
}

/**
 * Loads `askdb.config.*` / `.config/askdb.*` from `cwd` (if present) and returns the projection.
 * Does not mutate `process.env`.
 */
export async function loadAskDbConfigProjection(cwd: string): Promise<{
  path?: string;
  projection?: AskDbEnvProjection;
}> {
  const configPath = discoverAskDbConfigPath(cwd);
  if (!configPath) return {};

  const exported = await importConfigModule(configPath);
  return { path: configPath, projection: assertAskDbProjection(exported, configPath) };
}

/**
 * Synchronous variant for callers that cannot await at top-level (CLI uses this before `await program.parseAsync`).
 * Only supports config paths that jiti can load synchronously (covers `.ts` and most `.js`/`.cjs` cases).
 */
export function loadAskDbConfigProjectionSync(cwd: string): { path?: string; projection?: AskDbEnvProjection } {
  const configPath = discoverAskDbConfigPath(cwd);
  if (!configPath) return {};

  const lower = configPath.toLowerCase();
  if (lower.endsWith(".mjs")) {
    throw new Error(
      `Cannot load AskDB config synchronously: ${configPath} (.mjs requires async import). ` +
        `Use loadAskDbConfigProjection() or rename to .cjs/.js/.ts.`,
    );
  }

  const jiti = createJiti(configPath, { interopDefault: true });
  const mod = jiti(configPath) as { default?: unknown };
  const exported = mod.default ?? mod;
  return { path: configPath, projection: assertAskDbProjection(exported, configPath) };
}
