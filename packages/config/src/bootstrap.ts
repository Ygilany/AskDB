import dotenv from "dotenv";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadAskDbConfigProjectionSync } from "./load-merge.js";
import { setAskDbRuntime } from "./runtime-store.js";

/** dotenv logs the keys it injects unless `quiet` is set; bootstrap stays silent. */
const DOTENV_LOAD_OPTIONS = { quiet: true } as const;

/** `process.emitWarning` code for a deprecated `askdb.config` key. */
const CONFIG_DEPRECATION_CODE = "ASKDB_CONFIG_DEPRECATED";

/** Deprecation messages already emitted: a process that bootstraps twice warns once. */
const emittedDeprecations = new Set<string>();

function emitConfigDeprecations(deprecations: readonly string[] | undefined): void {
  for (const message of deprecations ?? []) {
    if (emittedDeprecations.has(message)) continue;
    emittedDeprecations.add(message);
    process.emitWarning(message, { type: "DeprecationWarning", code: CONFIG_DEPRECATION_CODE });
  }
}

export type BootstrapAskDbEnvOptions = {
  /** Working directory for `.env` default path and config discovery. Defaults to `process.cwd()`. */
  cwd?: string;
  /**
   * Explicit `.env` file paths to try in order. The first one that exists and loads wins; one that
   * exists but fails to load is skipped without a report. When none loads, the `.env` in the
   * process's working directory is tried. When omitted, loads `${cwd}/.env` only.
   */
  dotenvCandidatePaths?: readonly string[];
  /**
   * When `true` (default), an error loading `${cwd}/.env`, or the fallback `.env` after the
   * candidates, other than a missing file, is logged to stderr and `process.exitCode` is set to `1`.
   * Set `false` to throw instead. A candidate that fails to load is skipped, not reported.
   */
  dotenvNonFatal?: boolean;
};

function handleDotenvError(error: unknown, nonFatal: boolean | undefined): void {
  const err = error as { code?: unknown; message?: unknown };
  const code = typeof err.code === "string" ? err.code : undefined;
  const message = typeof err.message === "string" ? err.message : String(error);
  if (code === "ENOENT") return; // A missing `.env` is normal.
  if (nonFatal) {
    console.error(`Failed to load .env: ${message}`);
    process.exitCode = 1;
    return;
  }
  throw new Error(`Failed to load .env: ${message}`);
}

/**
 * Loads dotenv (optional `.env` candidates), then loads `askdb.config.*` / `.config/askdb.*`
 * and installs the AskDB runtime snapshot (structured config + flattened canonical keys).
 *
 * Does **not** merge AskDB settings into `process.env`. Use {@link getAskDbRuntimeConfig} to read configuration.
 *
 * `askdb.config.*` is the sole source of truth — use `env("VAR")` in the config file to read
 * from the environment at load time.
 *
 * Each deprecated config key in use is reported once per process as a `DeprecationWarning`
 * (code `ASKDB_CONFIG_DEPRECATED`); `getAskDbRuntimeConfig().deprecations` lists them for UIs.
 */
export function bootstrapAskDbEnv(options: BootstrapAskDbEnvOptions = {}): {
  dotenvPath?: string;
  configPath?: string;
} {
  const cwd = options.cwd ?? process.cwd();
  const nonFatal = options.dotenvNonFatal ?? true;
  let dotenvPath: string | undefined;

  if (options.dotenvCandidatePaths && options.dotenvCandidatePaths.length > 0) {
    for (const path of options.dotenvCandidatePaths) {
      if (!existsSync(path)) continue;
      const { error } = dotenv.config({ ...DOTENV_LOAD_OPTIONS, path });
      if (!error) {
        dotenvPath = path;
        break;
      }
    }
    if (dotenvPath === undefined) {
      const { error } = dotenv.config(DOTENV_LOAD_OPTIONS);
      if (error) handleDotenvError(error, nonFatal);
    }
  } else {
    const path = join(cwd, ".env");
    const { error } = dotenv.config({ ...DOTENV_LOAD_OPTIONS, path });
    if (error) handleDotenvError(error, nonFatal);
    else dotenvPath = path;
  }

  const { path: configPath, projection } = loadAskDbConfigProjectionSync(cwd);
  if (!configPath || !projection) {
    throw new Error(
      `No askdb.config.* or .config/askdb.* found under ${cwd}. ` +
        `Create one with \`askdb init\` or add defineConfig({ ... }) at the project root.`,
    );
  }

  setAskDbRuntime({
    structured: projection.config,
    flat: { ...projection.entries },
  });
  emitConfigDeprecations(projection.deprecations);

  return { dotenvPath, configPath };
}

/** Alias for {@link bootstrapAskDbEnv} (explicit naming). */
export const bootstrapAskDbRuntime = bootstrapAskDbEnv;
