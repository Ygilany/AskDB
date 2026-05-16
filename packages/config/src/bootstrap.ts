import dotenv from "dotenv";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadAskDbConfigProjectionSync } from "./load-merge.js";
import { setAskDbRuntime } from "./runtime-store.js";

export type BootstrapAskDbEnvOptions = {
  /** Working directory for `.env` default path and config discovery. Defaults to `process.cwd()`. */
  cwd?: string;
  /**
   * Explicit `.env` file paths to try in order. First existing file wins.
   * When omitted, loads `${cwd}/.env` only.
   */
  dotenvCandidatePaths?: readonly string[];
  /**
   * When `true` (default), non-ENOENT dotenv issues are logged to stderr and `process.exitCode`
   * is set to `1`, matching legacy `askdb` CLI / `@askdb/http-api` behavior. Set `false` to throw instead.
   */
  dotenvNonFatal?: boolean;
};

function handleDotenvError(error: unknown, nonFatal: boolean | undefined): void {
  const err = error as { code?: unknown; message?: unknown };
  const code = typeof err.code === "string" ? err.code : undefined;
  const message = typeof err.message === "string" ? err.message : String(error);
  if (code === "ENOENT") return;
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
 */
export function bootstrapAskDbEnv(options: BootstrapAskDbEnvOptions = {}): {
  dotenvPath?: string;
  configPath?: string;
} {
  const cwd = options.cwd ?? process.cwd();
  const nonFatal = options.dotenvNonFatal ?? true;
  let dotenvPath: string | undefined;

  if (options.dotenvCandidatePaths && options.dotenvCandidatePaths.length > 0) {
    let loaded = false;
    for (const path of options.dotenvCandidatePaths) {
      if (!existsSync(path)) continue;
      const { error } = dotenv.config({ path });
      if (!error) {
        loaded = true;
        dotenvPath = path;
        break;
      }
    }
    if (!loaded) {
      const { error } = dotenv.config();
      if (error) handleDotenvError(error, nonFatal);
    }
  } else {
    const path = join(cwd, ".env");
    const { error } = dotenv.config({ path });
    if (error) {
      const err = error as { code?: unknown; message?: unknown };
      const code = typeof err.code === "string" ? err.code : undefined;
      if (code === "ENOENT") {
        // Missing `.env` is normal.
      } else {
        handleDotenvError(error, nonFatal);
      }
    } else {
      dotenvPath = path;
    }
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

  return { dotenvPath, configPath };
}

/** Alias for {@link bootstrapAskDbEnv} (explicit naming). */
export const bootstrapAskDbRuntime = bootstrapAskDbEnv;
