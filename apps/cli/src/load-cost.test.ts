import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, expect, it } from "vitest";

const cliJs = join(import.meta.dirname, "../dist/cli.js");
const work = mkdtempSync(join(tmpdir(), "askdb-cli-load-cost-"));

afterAll(() => {
  rmSync(work, { recursive: true, force: true });
});

// Preloaded with --import, before dist/cli.js: records every `@askdb/prisma` and
// `@prisma/*` specifier the process resolves and prints them on exit.
const HOOK = `
import { registerHooks } from "node:module";
const loaded = new Set();
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@askdb/prisma") || specifier.startsWith("@prisma/")) loaded.add(specifier);
    return nextResolve(specifier, context);
  },
});
process.on("exit", () => process.stderr.write("PRISMA_MODULES " + JSON.stringify([...loaded]) + "\\n"));
`;

// `@askdb/prisma` is an optional peer of `askdb` (#259): the CLI registers it as a
// lazy connector entry, so only `--engine prisma` imports it (#339).
it("`askdb --help` resolves no @askdb/prisma or @prisma/* module", () => {
  const hook = join(work, "record-prisma.mjs");
  writeFileSync(hook, HOOK, "utf8");

  const run = spawnSync(process.execPath, ["--no-warnings", "--import", pathToFileURL(hook).href, cliJs, "--help"], {
    cwd: work,
    encoding: "utf8",
  });

  expect(run.status, run.stderr).toBe(0);
  expect(run.stdout).toContain("Usage: askdb");
  const line = run.stderr.split("\n").find((l) => l.startsWith("PRISMA_MODULES "));
  expect(JSON.parse(line!.slice("PRISMA_MODULES ".length))).toEqual([]);
});
