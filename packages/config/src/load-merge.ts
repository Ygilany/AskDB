import { createJiti } from "jiti";
import { pathToFileURL } from "node:url";
import { discoverAskDbConfigPath } from "./discover.js";
import { defineConfig, isAskDbEnvProjection, type AskDbEnvProjection } from "./projection.js";
import type { AskDbConfig } from "./types.js";

/** Loads a config file synchronously with jiti, whatever its extension (`.mjs` included). */
function requireConfigModule(configPath: string): unknown {
  const jiti = createJiti(configPath, { interopDefault: true });
  const mod = jiti(configPath) as { default?: unknown };
  return mod.default ?? mod;
}

async function importConfigModule(configPath: string): Promise<unknown> {
  if (configPath.toLowerCase().endsWith(".mjs")) {
    const mod = await import(pathToFileURL(configPath).href);
    return mod.default ?? mod;
  }
  return requireConfigModule(configPath);
}

/**
 * A config file's default export as a projection: `defineConfig({ ... })` as it is, and a plain
 * `export default { ... }` through `defineConfig`, so both get the same normalizing and checks.
 */
function toProjection(exported: unknown, configPath: string): AskDbEnvProjection {
  if (isAskDbEnvProjection(exported)) return exported;
  if (typeof exported === "object" && exported !== null && !Array.isArray(exported)) {
    return defineConfig(exported as AskDbConfig);
  }
  throw new Error(
    `AskDB config at ${configPath}: the default export isn't a config object; ` +
      `export default { ... } or defineConfig({ ... }) from "@askdb/config".`,
  );
}

const CONFIG_ERROR_PREFIX = "askdb.config: ";

/**
 * Names the file in an `askdb.config: …` error, which `defineConfig` throws without knowing it
 * (inside the config file, or here for a plain object). Any other error passes through as it is.
 */
function namingFile(error: unknown, configPath: string): unknown {
  if (!(error instanceof Error) || !error.message.startsWith(CONFIG_ERROR_PREFIX)) return error;
  return new Error(`AskDB config at ${configPath}: ${error.message.slice(CONFIG_ERROR_PREFIX.length)}`, {
    cause: error,
  });
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

  try {
    const exported = await importConfigModule(configPath);
    return { path: configPath, projection: toProjection(exported, configPath) };
  } catch (error) {
    throw namingFile(error, configPath);
  }
}

/**
 * Synchronous variant for callers that cannot await at top-level (`bootstrapAskDbEnv()`, so the
 * CLI). Loads every supported extension, `.mjs` included; the file can't use top-level `await`.
 */
export function loadAskDbConfigProjectionSync(cwd: string): { path?: string; projection?: AskDbEnvProjection } {
  const configPath = discoverAskDbConfigPath(cwd);
  if (!configPath) return {};

  try {
    const exported = requireConfigModule(configPath);
    return { path: configPath, projection: toProjection(exported, configPath) };
  } catch (error) {
    throw namingFile(error, configPath);
  }
}
