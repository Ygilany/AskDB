import dotenv from "dotenv";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadAskDbConfigProjectionSync } from "./load-merge.js";
import { setAskDbRuntime } from "./runtime-store.js";

/**
 * After loading `askdb.config.*`, non-empty values for these keys in `process.env`
 * override the flattened snapshot (tests, subprocess env, platform-assigned `PORT`, …).
 * Scoped to `@askdb/config` bootstrap only — library code still uses `getAskDbRuntimeConfig()`.
 */
const RUNTIME_SHELL_FLAT_OVERRIDES: readonly string[] = [
  "ASKDB_MOCK_SQL",
  "ASKDB_CORRELATION_ID",
  "ASKDB_PRISMA_SCHEMA",
  "ASKDB_INTROSPECT_OUT",
  "DATABASE_URL",
  "PORT",
  "HOST",
];

function mergeShellOverridesOntoFlat(flat: Record<string, string>): void {
  for (const key of RUNTIME_SHELL_FLAT_OVERRIDES) {
    const raw = process.env[key];
    if (raw === undefined) continue;
    const trimmed = raw.trim();
    if (trimmed === "") continue;
    flat[key] = trimmed;
  }
}

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
 * A small allowlist of shell variables (e.g. `ASKDB_MOCK_SQL`, `ASKDB_CORRELATION_ID`,
 * `ASKDB_PRISMA_SCHEMA`, `ASKDB_INTROSPECT_OUT`, `DATABASE_URL`, `PORT`, `HOST`) may override flattened entries
 * so CI/subprocesses can inject values such as `ASKDB_MOCK_SQL` without editing the config file.
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

  const flat: Record<string, string> = { ...projection.entries };
  mergeShellOverridesOntoFlat(flat);

  setAskDbRuntime({
    structured: projection.config,
    flat,
  });

  return { dotenvPath, configPath };
}

/** Alias for {@link bootstrapAskDbEnv} (explicit naming). */
export const bootstrapAskDbRuntime = bootstrapAskDbEnv;
