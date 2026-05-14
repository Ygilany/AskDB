import { createJiti } from "jiti";
import { pathToFileURL } from "node:url";
import { discoverAskDbConfigPath } from "./discover.js";
import { isAskDbEnvProjection } from "./projection.js";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidEnvKey(key: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key);
}

function mergeEntries(entries: Readonly<Record<string, string>>): void {
  for (const [key, value] of Object.entries(entries)) {
    if (!isValidEnvKey(key)) {
      throw new Error(`AskDB config contains invalid environment variable name: "${key}"`);
    }
    if (typeof value !== "string") {
      throw new Error(`AskDB config produced non-string for "${key}".`);
    }
    if (value.trim() === "") continue;
    process.env[key] = value;
  }
}

function isLegacyFlatEnvMap(value: Record<string, unknown>): boolean {
  for (const [k, v] of Object.entries(value)) {
    if (!isValidEnvKey(k)) return false;
    if (typeof v !== "string") return false;
  }
  return true;
}

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

function applyExportedConfig(exported: unknown, configPath: string): void {
  if (isAskDbEnvProjection(exported)) {
    mergeEntries(exported.entries);
    return;
  }

  if (!isPlainObject(exported)) {
    throw new Error(
      `AskDB config at ${configPath} must export defineConfig({ ... }) or a legacy flat string map.`,
    );
  }

  if (isLegacyFlatEnvMap(exported)) {
    mergeEntries(exported as Record<string, string>);
    return;
  }

  throw new Error(
    `AskDB config at ${configPath} has an unsupported shape. ` +
      `Use export default defineConfig({ ... }) from "@askdb/config" (nested grouping), ` +
      `or a legacy flat map of string values only.`,
  );
}

/**
 * Loads `askdb.config.*` / `.config/askdb.*` from `cwd` (if present) and merges string
 * values into `process.env` (only non-empty values; invalid keys are skipped).
 */
export async function mergeAskDbConfigIntoEnv(cwd: string): Promise<{ path?: string }> {
  const configPath = discoverAskDbConfigPath(cwd);
  if (!configPath) return {};

  const exported = await importConfigModule(configPath);
  applyExportedConfig(exported, configPath);
  return { path: configPath };
}

/**
 * Synchronous variant for callers that cannot await at top-level (CLI uses this before `await program.parseAsync`).
 * Only supports config paths that jiti can load synchronously (covers `.ts` and most `.js`/`.cjs` cases).
 */
export function mergeAskDbConfigIntoEnvSync(cwd: string): { path?: string } {
  const configPath = discoverAskDbConfigPath(cwd);
  if (!configPath) return {};

  const lower = configPath.toLowerCase();
  if (lower.endsWith(".mjs")) {
    throw new Error(
      `Cannot load AskDB config synchronously: ${configPath} (.mjs requires async import). ` +
        `Use mergeAskDbConfigIntoEnv() or rename to .cjs/.js/.ts.`,
    );
  }

  const jiti = createJiti(configPath, { interopDefault: true });
  const mod = jiti(configPath) as { default?: unknown };
  const exported = mod.default ?? mod;
  applyExportedConfig(exported, configPath);
  return { path: configPath };
}
