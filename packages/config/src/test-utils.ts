import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getAskDbRuntimeConfig } from "./runtime-config.js";
import { setAskDbRuntimeForTests } from "./runtime-store.js";
import type { AskDbConfig } from "./types.js";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Make `@askdb/config` resolvable from `projectDir`, so a test can write an `askdb.config.*` there
 * and load it the way a user's project does. jiti compiles a TypeScript config, and the package's
 * source with it. Node loads a JavaScript config and its imports itself, so `built` links `dist`
 * instead, as an install does; the test task builds the package first.
 */
export function linkWorkspacePackage(projectDir: string, { built = false }: { built?: boolean } = {}): void {
  const nmAskdb = join(projectDir, "node_modules", "@askdb");
  mkdirSync(nmAskdb, { recursive: true });
  const linkedPackage = join(nmAskdb, "config");
  mkdirSync(linkedPackage, { recursive: true });
  const folder = built ? "dist" : "src";
  const entry = built ? "./dist/index.js" : "./src/index.ts";
  symlinkSync(join(pkgRoot, folder), join(linkedPackage, folder), "dir");
  writeFileSync(
    join(linkedPackage, "package.json"),
    JSON.stringify({ name: "@askdb/config", type: "module", main: entry, exports: { ".": entry } }, null, 2),
    "utf8",
  );
}

/**
 * Every value the resolved runtime view holds, as one string: the flat map and the typed sections
 * (`ai.language.connection.apiKey`, …), but not `structured`, the config as authored. A value
 * found here was read by the resolver, not just carried along. Installs `config` as the runtime.
 */
export function resolvedRuntimeText(config: AskDbConfig): string {
  setAskDbRuntimeForTests(config);
  const { structured: _authored, ...resolved } = getAskDbRuntimeConfig();
  return JSON.stringify(resolved);
}
