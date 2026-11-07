import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { entryPoints, exportedNames, undocumented } from "./check-export-coverage.mjs";

test("the check runs when started through a symbolic link, instead of exiting without checking", () => {
  const link = join(mkdtempSync(join(tmpdir(), "export-coverage-")), "check.mjs");
  symlinkSync(fileURLToPath(new URL("./check-export-coverage.mjs", import.meta.url)), link);
  const output = execFileSync(process.execPath, [link], { encoding: "utf8" });
  assert.match(output, /Every export of core, client, config and ai is named on its API page\./);
});

test("exportedNames resolves export *, named and type-only re-exports from source", () => {
  const dir = mkdtempSync(join(tmpdir(), "export-coverage-"));
  writeFileSync(join(dir, "a.ts"), "export const alpha = 1;\nexport function beta() {}\n");
  writeFileSync(join(dir, "b.ts"), "export type Gamma = { x: number };\nexport const hidden = 2;\n");
  writeFileSync(join(dir, "index.ts"), 'export * from "./a.js";\nexport type { Gamma } from "./b.js";\n');
  assert.deepEqual(exportedNames(join(dir, "index.ts")), ["Gamma", "alpha", "beta"]);
});

test("undocumented reports a planted export the page never names, and nothing else", () => {
  const page = "Call `ask()` with an `AskUsage`. See askOptions for more. ASKDB_MODES_V1 lists them.";
  assert.deepEqual(undocumented(["ask", "AskUsage", "ASKDB_MODES_V1", "plantedExport"], page), ["plantedExport"]);
});

test("undocumented matches whole words only", () => {
  assert.deepEqual(undocumented(["ask", "Retriever"], "askAgain and RetrieverOptions"), ["ask", "Retriever"]);
});

test("entryPoints maps each export target to its source file, and refuses one it can't map", () => {
  const dir = mkdtempSync(join(tmpdir(), "export-coverage-"));
  mkdirSync(join(dir, "src"));
  const packageJson = {
    exports: {
      ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
      "./scaffold": { types: "./dist/scaffold/index.d.ts", import: "./dist/scaffold/index.js" },
    },
  };
  assert.deepEqual(entryPoints(dir, packageJson), [join(dir, "src/index.ts"), join(dir, "src/scaffold/index.ts")]);
  assert.throws(() => entryPoints(dir, { exports: { ".": "./lib/index.cjs" } }), /can't map the export target/);
});
