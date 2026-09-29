// node --test scripts/check-test-gating.test.mjs  (runs from the root `lint` script)
//
// Fixture corpus: scripts/__fixtures__/check-test-gating/<rule>.hit.ts must report exactly the
// lines marked `// HIT`, all under <rule>; every *.clean.ts must report nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { RULES, findGates } from "./check-test-gating.mjs";

const here = fileURLToPath(new URL(".", import.meta.url));
const fixtures = join(here, "__fixtures__", "check-test-gating");
const script = join(here, "check-test-gating.mjs");
const files = readdirSync(fixtures);

test("every rule has a hit fixture and a clean fixture", () => {
  for (const { id } of RULES) {
    assert.ok(files.includes(`${id}.hit.ts`), `missing ${id}.hit.ts`);
    assert.ok(files.includes(`${id}.clean.ts`), `missing ${id}.clean.ts`);
  }
});

for (const file of files) {
  const src = readFileSync(join(fixtures, file), "utf8");
  if (file.endsWith(".hit.ts")) {
    const rule = file.slice(0, -".hit.ts".length);
    test(`${file}: reports exactly the HIT lines under ${rule}`, () => {
      const expected = src
        .split("\n")
        .flatMap((line, i) => (/\/\/ HIT\b/.test(line) ? [{ line: i + 1, rule }] : []));
      assert.ok(expected.length > 0);
      assert.deepEqual(
        findGates(src).map(({ line, rule }) => ({ line, rule })),
        expected,
      );
    });
  } else if (file.endsWith(".clean.ts")) {
    test(`${file}: reports nothing`, () => {
      assert.deepEqual(findGates(src), []);
    });
  }
}

function workspace(testFiles) {
  const root = mkdtempSync(join(tmpdir(), "check-test-gating-"));
  writeFileSync(
    join(root, "pnpm-workspace.yaml"),
    'packages:\n  - "packages/*"\n  # comment\n  - "!packages/excluded"\n  - "fixtures/db"\nother: 1\n',
  );
  for (const [path, body] of Object.entries(testFiles)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), body);
  }
  return root;
}

function run(root) {
  return spawnSync(process.execPath, [script, root], { encoding: "utf8" });
}

test("CLI scans every workspace package (not just src/) and skips excluded ones", () => {
  const root = workspace({
    "packages/a/src/a.test.ts": 'it("ok", () => {});\n',
    "packages/excluded/src/x.test.ts": 'describe.skip("excluded package", () => {});\n',
    "packages/a/node_modules/dep/y.test.ts": 'describe.skip("dependency", () => {});\n',
    "fixtures/db/test/db.integration.test.ts": 'describe.skip("outside src", () => {});\n',
  });
  try {
    const result = run(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /fixtures\/db\/test\/db\.integration\.test\.ts:1:/);
    assert.doesNotMatch(result.stderr, /excluded|node_modules/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI passes a clean workspace", () => {
  const root = workspace({ "packages/a/src/a.test.ts": 'it("ok", () => {});\n' });
  try {
    const result = run(root);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /OK \(1 test files/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI fails closed when it finds no test files or no workspace", () => {
  const empty = workspace({});
  try {
    assert.equal(run(empty).status, 1);
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
  assert.equal(run(join(tmpdir(), "check-test-gating-does-not-exist")).status, 1);
});
