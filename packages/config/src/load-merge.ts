import { createJiti } from "jiti";
import { pathToFileURL } from "node:url";
import { discoverAskDbConfigPath } from "./discover.js";
import { isPlainObject } from "./normalize.js";
import { defineConfig, isAskDbEnvProjection, type AskDbEnvProjection } from "./projection.js";
import type { AskDbConfig } from "./types.js";

const CONFIG_FORMS = 'export default { ... } or defineConfig({ ... }) from "@askdb/config"';

/**
 * A config module's default export. An ES module (jiti's transpiled exports or a native module
 * namespace) must have one; a CommonJS module's `module.exports` is the config itself.
 */
function defaultExport(mod: unknown, configPath: string): unknown {
  const isEsModule =
    typeof mod === "object" &&
    mod !== null &&
    ((mod as { __esModule?: unknown }).__esModule === true ||
      Object.prototype.toString.call(mod) === "[object Module]");
  if (!isEsModule) return mod;
  if (!("default" in mod)) {
    throw new Error(`AskDB config at ${configPath}: the file has no default export; ${CONFIG_FORMS}.`);
  }
  return (mod as { default: unknown }).default;
}

/** Loads a config file synchronously with jiti, whatever its extension (`.mjs` included). */
function requireConfigModule(configPath: string): unknown {
  const jiti = createJiti(configPath, { interopDefault: false });
  return defaultExport(jiti(configPath), configPath);
}

async function importConfigModule(configPath: string): Promise<unknown> {
  if (configPath.toLowerCase().endsWith(".mjs")) {
    return defaultExport(await import(pathToFileURL(configPath).href), configPath);
  }
  return requireConfigModule(configPath);
}

/**
 * A config file's default export as a projection: `defineConfig({ ... })` as it is, and a plain
 * `export default { ... }` through `defineConfig`, so both get the same normalizing and checks.
 */
function toProjection(exported: unknown, configPath: string): AskDbEnvProjection {
  if (isAskDbEnvProjection(exported)) return exported;
  if (isPlainObject(exported)) return defineConfig(exported as AskDbConfig);
  if (typeof (exported as { then?: unknown } | null | undefined)?.then === "function") {
    throw new Error(
      `AskDB config at ${configPath}: the default export is a Promise; AskDB loads the config file ` +
        `synchronously, so export the config object itself.`,
    );
  }
  throw new Error(`AskDB config at ${configPath}: the default export isn't a config object; ${CONFIG_FORMS}.`);
}

const CONFIG_ERROR_PREFIX = "askdb.config: ";

/** `await` the synchronous load can't run: top-level, or anywhere outside an async function. */
function isAwaitError(error: Error): boolean {
  return (
    (error as { code?: unknown }).code === "ERR_REQUIRE_ASYNC_MODULE" ||
    (error.name === "SyntaxError" && error.message.includes("await is only valid in async functions"))
  );
}

/**
 * Names the file in an error raised while it loads: an `askdb.config: …` error, which
 * `defineConfig` throws without knowing the file (inside it, or here for a plain object), and an
 * `await` the synchronous load can't run, whose engine message names neither. Any other error
 * passes through as it is.
 */
function namingFile(error: unknown, configPath: string): unknown {
  if (!(error instanceof Error)) return error;
  if (error.message.startsWith(CONFIG_ERROR_PREFIX)) {
    return new Error(`AskDB config at ${configPath}: ${error.message.slice(CONFIG_ERROR_PREFIX.length)}`, {
      cause: error,
    });
  }
  if (isAwaitError(error)) {
    return new Error(
      `AskDB config at ${configPath}: AskDB loads the config file synchronously, so it can't use top-level await ` +
        `(or await outside an async function). Compute the value before AskDB loads the file, or drop the await.`,
      { cause: error },
    );
  }
  return error;
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
