import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCHEMA_PATH = resolve(PACKAGE_DIR, "test-fixtures/simple/schema.prisma");

// Runs in a fresh Node process against the built package (turbo builds it before `test`),
// importing it by name the way the askdb CLI and Studio do. A resolve hook records every
// `@prisma/*` module the process loads, before and after the first describe.
const PROBE = `
import { registerHooks } from "node:module";
const loaded = new Set();
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@prisma/")) loaded.add(specifier);
    return nextResolve(specifier, context);
  },
});
const prisma = await import("@askdb/prisma");
const afterImport = [...loaded];
await prisma.describePrismaSchema({ schemaPath: process.env.PROBE_SCHEMA_PATH });
console.log(JSON.stringify({ afterImport, afterDescribe: [...loaded] }));
`;

it("loads @prisma/internals on the first describe, not when @askdb/prisma is imported", () => {
  const run = spawnSync(process.execPath, ["--input-type=module", "--no-warnings", "-e", PROBE], {
    cwd: PACKAGE_DIR,
    encoding: "utf8",
    env: { ...process.env, PROBE_SCHEMA_PATH: SCHEMA_PATH },
  });
  expect(run.status, run.stderr).toBe(0);

  const { afterImport, afterDescribe } = JSON.parse(run.stdout) as {
    afterImport: string[];
    afterDescribe: string[];
  };
  expect(afterImport).toEqual([]);
  expect(afterDescribe).toContain("@prisma/internals");
});
