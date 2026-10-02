/**
 * Runs a probe test file under the lab's real matrix reporter in a scratch root, so tests of
 * the reporter, and of what reads its `matrix.json`, never touch the lab's own `.lab/`.
 *
 * The scratch root holds the lab's `src/matrix-reporter.ts`, `src/paths.ts` and
 * `src/fixture.ts`, copied verbatim (the last with its fixture path made absolute), and a
 * symlink to the lab's `node_modules`.
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll } from "vitest";

export const LAB = fileURLToPath(new URL("../..", import.meta.url));
const FIXTURE_INDEX = fileURLToPath(new URL("../../../../fixtures/multi-engine/src/index.js", import.meta.url));
const scratch: string[] = [];
afterAll(() => scratch.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

export interface MatrixJson {
  rows: { scenario: string; cells: Record<string, { text: string; failures?: { test: string; reason: string }[] }> }[];
}

/**
 * Run `body` (a test file's describe blocks) under the matrix reporter. Returns the run's exit
 * status and output, the `matrix.json` it wrote and that file's path, and the step summary.
 */
export function runMatrix(body: string) {
  const dir = mkdtempSync(join(tmpdir(), "lab-matrix-"));
  scratch.push(dir);
  mkdirSync(join(dir, "src"));
  mkdirSync(join(dir, "test"));
  for (const file of ["matrix-reporter.ts", "paths.ts"]) cpSync(join(LAB, "src", file), join(dir, "src", file));
  const fixture = readFileSync(join(LAB, "src", "fixture.ts"), "utf8").replace("../../../fixtures/multi-engine/src/index.js", FIXTURE_INDEX);
  writeFileSync(join(dir, "src", "fixture.ts"), fixture);
  symlinkSync(join(LAB, "node_modules"), join(dir, "node_modules"), "dir");
  writeFileSync(join(dir, "test", "probe.test.ts"), `import { describe, expect, it } from "vitest";\n${body}\n`);
  const summary = join(dir, "summary.md");
  const env = { ...process.env, GITHUB_STEP_SUMMARY: summary };
  const run = spawnSync(
    process.execPath,
    [join(LAB, "node_modules", "vitest", "vitest.mjs"), "run", "--root", dir, "--reporter=default", "--reporter=./src/matrix-reporter.ts"],
    { cwd: dir, encoding: "utf8", env },
  );
  const file = join(dir, ".lab", "matrix.json");
  return {
    status: run.status,
    out: `${run.stdout}\n${run.stderr}`,
    file,
    json: JSON.parse(readFileSync(file, "utf8")) as MatrixJson,
    summary: existsSync(summary) ? readFileSync(summary, "utf8") : "",
  };
}
