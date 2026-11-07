import { createJiti } from "jiti";
import { extname } from "node:path";
import { pathToFileURL } from "node:url";
import { discoverAskDbConfigPath, type AskDbConfigExtension } from "./discover.js";
import { isPlainObject } from "./resolve.js";
import { defineConfig, isAskDbEnvProjection, type AskDbEnvProjection } from "./projection.js";
import type { AskDbConfig } from "./types.js";

const CONFIG_FORMS = 'export default { ... } or defineConfig({ ... }) from "@askdb/config"';
const CONFIG_ERROR_PREFIX = "askdb.config: ";

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
  return mod.default;
}

/** How each extension discovery finds loads: jiti compiles TypeScript, and Node loads JavaScript itself. */
const CONFIG_LOADERS = {
  ts: "jiti",
  mts: "jiti",
  cts: "jiti",
  js: "node",
  mjs: "node",
  cjs: "node",
} as const satisfies Record<AskDbConfigExtension, "jiti" | "node">;

function loadsWithNode(configPath: string): boolean {
  return (CONFIG_LOADERS as Record<string, string>)[extname(configPath).slice(1).toLowerCase()] === "node";
}

/**
 * The error each JavaScript config last failed to load with. Node keeps an ES module whose
 * evaluation threw, and rethrows the same error object for every later load of it, so the same
 * object again means this process can't load the file anew, whatever was fixed since.
 */
const failedNodeLoads = new Map<string, unknown>();

/** `error` from Node loading `configPath`, or an error that says to restart when Node threw it before. */
function nodeLoadError(configPath: string, error: unknown): unknown {
  const repeated = typeof error === "object" && error !== null && failedNodeLoads.get(configPath) === error;
  failedNodeLoads.set(configPath, error);
  if (!repeated) return error;
  const message = error instanceof Error ? error.message : String(error);
  const reason = message.startsWith(CONFIG_ERROR_PREFIX) ? message.slice(CONFIG_ERROR_PREFIX.length) : message;
  return new Error(
    `AskDB config at ${configPath}: this ES module failed to load earlier in this process, and Node doesn't load it ` +
      `again. Restart the process to load your changes. It failed with: ${reason}`,
    { cause: error },
  );
}

/**
 * Loads a config file synchronously. A JavaScript config loads with Node's own `require`, by
 * Node's rules (an ES module through `require(esm)`), so it loads from inside an app's bundle,
 * where jiti can't start (#833). `process.getBuiltinModule` gets that `require` past bundlers,
 * which rewrite `node:module` imports and `require` calls.
 *
 * A TypeScript config loads with jiti. `interopDefault` stays on: it is what lets the file
 * default-import a CommonJS package (`import dotenv from "dotenv"`). jiti then returns the
 * exports behind a proxy that merges in the default export, so the default export is read from
 * the module cache, which holds the exports as the file wrote them. With jiti's module cache
 * off, the proxy's default is used.
 */
function requireConfigModule(configPath: string): unknown {
  if (loadsWithNode(configPath)) {
    const { createRequire } = process.getBuiltinModule("node:module");
    let mod: unknown;
    try {
      mod = createRequire(configPath)(configPath);
    } catch (error) {
      throw nodeLoadError(configPath, error);
    }
    failedNodeLoads.delete(configPath);
    return defaultExport(mod, configPath);
  }
  const jiti = createJiti(configPath, { interopDefault: true });
  const loaded = jiti(configPath) as { default?: unknown } | null | undefined;
  const cached = jiti.cache[jiti.resolve(configPath)];
  if (cached) return defaultExport(cached.exports, configPath);
  return loaded?.default ?? loaded;
}

async function importConfigModule(configPath: string): Promise<unknown> {
  if (configPath.toLowerCase().endsWith(".mjs")) {
    let mod: unknown;
    try {
      mod = await import(/* webpackIgnore: true */ pathToFileURL(configPath).href);
    } catch (error) {
      throw nodeLoadError(configPath, error);
    }
    failedNodeLoads.delete(configPath);
    return defaultExport(mod, configPath);
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
