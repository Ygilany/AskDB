import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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
