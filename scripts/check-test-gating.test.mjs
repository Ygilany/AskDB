// node --test scripts/check-test-gating.test.mjs  (runs from the root `lint` script)
//
// Fixture corpus: scripts/__fixtures__/check-test-gating/<rule>.hit.ts(x) must report exactly the
// lines marked `// HIT`, all under <rule>; every *.clean.ts(x) must report nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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
  const hit = file.match(/^(.+)\.hit\.tsx?$/);
  if (hit) {
    const rule = hit[1];
    test(`${file}: reports exactly the HIT lines under ${rule}`, () => {
      const expected = src
        .split("\n")
        .flatMap((line, i) => (/\/\/ HIT\b/.test(line) ? [{ line: i + 1, rule }] : []));
      assert.ok(expected.length > 0);
      assert.deepEqual(
        findGates(src, file).map(({ line, rule }) => ({ line, rule })),
        expected,
      );
    });
  } else if (/\.clean\.tsx?$/.test(file)) {
    test(`${file}: reports nothing`, () => {
      assert.deepEqual(findGates(src, file), []);
    });
  }
}

test("a file that does not parse throws instead of passing", () => {
  assert.throws(() => findGates('describe.skip("unterminated", () => {\n'), /line \d+:/);
  assert.throws(() => findGates("const x = <p>jsx</p>;\n", "x.test.ts"));
});

const DEFAULT_YAML =
  'packages:\n  - "packages/*"\n  # comment\n  - "!packages/excluded"\n  - "fixtures/db"\nother: 1\n';

/** A temp workspace removed after the test `t` finishes. */
function workspace(t, testFiles, yaml = DEFAULT_YAML) {
  const root = mkdtempSync(join(tmpdir(), "check-test-gating-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, "pnpm-workspace.yaml"), yaml);
  for (const [path, body] of Object.entries(testFiles)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), body);
  }
  return root;
}

function run(root, scriptPath = script, nodeFlags = []) {
  return spawnSync(process.execPath, [...nodeFlags, scriptPath, root], { encoding: "utf8" });
}

test("CLI scans every workspace package (not just src/) and skips excluded ones", (t) => {
  const root = workspace(t, {
    "packages/a/src/a.test.ts": 'it("ok", () => {});\n',
    "packages/excluded/src/x.test.ts": 'describe.skip("excluded package", () => {});\n',
    "packages/a/node_modules/dep/y.test.ts": 'describe.skip("dependency", () => {});\n',
    "fixtures/db/test/db.integration.test.ts": 'describe.skip("outside src", () => {});\n',
  });
  const result = run(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /fixtures\/db\/test\/db\.integration\.test\.ts:1:/);
  assert.doesNotMatch(result.stderr, /excluded|node_modules/);
});

test("CLI keeps reading the packages list past a column-0 comment", (t) => {
  const root = workspace(
    t,
    {
      "packages/a/src/a.test.ts": 'it("ok", () => {});\n',
      "fixtures/db/test/db.test.ts": 'describe.skip("db", () => {});\n',
    },
    'packages:\n  - "packages/*"\n# Shared fixture\n  - "fixtures/db"\n',
  );
  const result = run(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /fixtures\/db\/test\/db\.test\.ts:1:/);
});

test("CLI fails closed on a packages line it cannot read", (t) => {
  const root = workspace(t, { "packages/a/src/a.test.ts": 'it("ok", () => {});\n' }, "packages:\n  packages/a\n");
  const result = run(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /unrecognized line/);
});

test("CLI runs when invoked through a symlinked path", (t) => {
  const root = workspace(t, { "packages/a/src/a.test.ts": 'describe.skip("gated", () => {});\n' });
  const link = join(root, "linked-check.mjs");
  symlinkSync(script, link);
  for (const flags of [[], ["--preserve-symlinks-main"]]) {
    const result = run(root, link, flags);
    assert.equal(result.status, 1, `flags ${flags.join(" ") || "(none)"}`);
    assert.match(result.stderr, /packages\/a\/src\/a\.test\.ts:1:/);
  }
});

test("CLI passes a clean workspace", (t) => {
  const root = workspace(t, { "packages/a/src/a.test.ts": 'it("ok", () => {});\n' });
  const result = run(root);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /OK \(1 test files/);
});

test("CLI fails closed on a test file it cannot parse", (t) => {
  const root = workspace(t, {
    "packages/a/src/a.test.ts": 'it("ok", () => {});\n',
    "packages/a/src/broken.test.ts": 'describe.skip("unterminated", () => {\n',
  });
  const result = run(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /packages\/a\/src\/broken\.test\.ts: cannot be parsed/);
});

test("CLI fails closed when it finds no test files", (t) => {
  const result = run(workspace(t, {}));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /refusing to pass an empty scan/);
});

test("CLI fails closed when there is no workspace", () => {
  const result = run(join(tmpdir(), "check-test-gating-does-not-exist"));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /cannot read the workspace/);
});
