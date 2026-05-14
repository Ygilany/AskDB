import dotenv from "dotenv";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { mergeAskDbConfigIntoEnvSync } from "./load-merge.js";

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
   * is set to `1`, matching legacy `@askdb/cli` / `@askdb/http-api` behavior. Set `false` to throw instead.
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
 * Loads dotenv (optional `.env` candidates), then merges `askdb.config.*` / `.config/askdb.*`
 * into `process.env` when present.
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

  const { path: configPath } = mergeAskDbConfigIntoEnvSync(cwd);
  return { dotenvPath, configPath };
}
