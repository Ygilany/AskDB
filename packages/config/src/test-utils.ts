import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getAskDbRuntimeConfig } from "./runtime-config.js";
import { setAskDbRuntimeForTests } from "./runtime-store.js";
import type { AskDbConfig } from "./types.js";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Make `@askdb/config` resolvable from `projectDir` as this package's source, so a test can
 * write an `askdb.config.ts` there and load it the way a user's project does.
 */
export function linkWorkspacePackage(projectDir: string): void {
  const nmAskdb = join(projectDir, "node_modules", "@askdb");
  mkdirSync(nmAskdb, { recursive: true });
  const linkedPackage = join(nmAskdb, "config");
  mkdirSync(linkedPackage, { recursive: true });
  symlinkSync(join(pkgRoot, "src"), join(linkedPackage, "src"), "dir");
  writeFileSync(
    join(linkedPackage, "package.json"),
    JSON.stringify(
      {
        name: "@askdb/config",
        type: "module",
        main: "./src/index.ts",
        exports: {
          ".": "./src/index.ts",
        },
      },
      null,
      2,
    ),
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
