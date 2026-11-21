/**
 * The feature-map check itself: each rule fails on a map or replay that breaks it, and the
 * repo's own map passes. `check-feature-map.mjs` lists the rules.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { checkFeatureMap, parseReplayTests } from "./check-feature-map.mjs";

const SECTIONS = "## How to get to it (user POV)\n\n- Run it.\n\n## Driving it with control-askdb\n\nPreconditions:\n\n- Baseline.\n\n## Gotchas\n\n- None.\n";
const feature = (subFeatures: string[]) => `# Thing\n\nWhat it does.\n\n## Sub-features\n\n${subFeatures.join("\n")}\n\n${SECTIONS}`;
const README = "# Map\n\n- [Thing](./thing.md) covers the thing.\n";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A repo with one feature file and its replay; `files` overrides or adds files by path. */
function messages(files: Record<string, string> = {}): string[] {
  const root = mkdtempSync(join(tmpdir(), "feature-map-"));
  roots.push(root);
  const all = {
    "map/README.md": README,
    "map/thing.md": feature(["- `thing-run` runs. Scripted: `e2e/cli/thing.test.ts`.", "- `thing-look` is looked at. Agent-driven."]),
    "e2e/cli/thing.test.ts": 'it("thing-run: runs", () => {});\n',
    ...files,
  };
  for (const [path, text] of Object.entries(all)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return checkFeatureMap({ repoRoot: root, mapDir: "map", replayDir: "e2e" }).map((p) => `${p.file}:${p.line}: ${p.message}`);
}

describe("check-feature-map", () => {
  it("passes this repo's feature map and replays", () => {
    const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
    expect(checkFeatureMap({ repoRoot })).toEqual([]);
  });

  it("passes a map whose scripted sub-feature has a test named with it", () => {
    expect(messages()).toEqual([]);
  });

  it("fails a Scripted path that does not exist", () => {
    const out = messages({ "map/thing.md": feature(["- `thing-run` runs. Scripted: `e2e/cli/gone.test.ts`."]) });
    expect(out).toContain("map/thing.md:7: `thing-run` is scripted to e2e/cli/gone.test.ts, which is not a replay file under e2e/");
  });

  it("fails a scripted sub-feature with no test named with it, and does not take a longer ID for it", () => {
    const out = messages({
      "map/thing.md": feature(["- `thing-run` runs. Scripted: `e2e/cli/thing.test.ts`.", "- `thing-run-twice` runs again. Scripted: `e2e/cli/thing.test.ts`."]),
      "e2e/cli/thing.test.ts": 'it("thing-run-twice: runs again", () => {});\n',
    });
    expect(out).toEqual(["map/thing.md:7: `thing-run` is scripted to e2e/cli/thing.test.ts, which has no test named with it"]);
  });

  it("fails a test named with an ID the map does not have, such as a pinned bug's own name", () => {
    const out = messages({ "e2e/cli/thing.test.ts": 'it("thing-run: runs", () => {});\nit("thing-run-status: known bug", () => {});\n' });
    expect(out).toEqual(["e2e/cli/thing.test.ts:2: `thing-run-status` is not a sub-feature in the map; name a pinned-bug test with the sub-feature it belongs to"]);
  });

  it("fails a test for a sub-feature the map calls Agent-driven, or scripts elsewhere", () => {
    const out = messages({ "e2e/cli/thing.test.ts": 'it("thing-run and thing-look: runs", () => {});\n' });
    expect(out).toEqual(['e2e/cli/thing.test.ts:1: `thing-look` has a test here, but map/thing.md:8 does not say "Scripted: `e2e/cli/thing.test.ts`"']);
  });

  it("fails a test whose name starts with no ID", () => {
    const out = messages({ "e2e/cli/thing.test.ts": 'it("thing-run: runs", () => {});\nit("Runs the thing", () => {});\n' });
    expect(out).toEqual(['e2e/cli/thing.test.ts:2: "Runs the thing" must start with the sub-feature IDs it replays, then ":"']);
  });

  it("fails a sub-feature line with no ending, a repeated ID and sections out of order", () => {
    expect(messages({ "map/thing.md": feature(["- `thing-run` runs. Scripted: `e2e/cli/thing.test.ts`.", "- `thing-look` is looked at."]) })).toEqual([
      'map/thing.md:8: `thing-look` must end "Scripted: `<replay path>`." (paths joined by "and") or "Agent-driven."',
    ]);
    expect(messages({ "map/other.md": feature(["- `thing-run` runs too. Agent-driven."]), "map/README.md": `${README}- [Other](./other.md)\n` })).toContain(
      "map/thing.md:7: `thing-run` is already a sub-feature at map/other.md:7",
    );
    expect(messages({ "map/thing.md": feature(["- `thing-run` runs. Scripted: `e2e/cli/thing.test.ts`."]).replace("## Gotchas", "## Traps") })[0]).toMatch(/the H2 sections must be, in order/);
  });

  it("fails a feature file the README does not link", () => {
    expect(messages({ "map/README.md": "# Map\n" })).toEqual(["map/README.md:1: no link to ./thing.md under Features"]);
  });
});

describe("parseReplayTests", () => {
  it("reads the IDs before the colon, joined by commas or and, with a note in brackets", () => {
    const tests = parseReplayTests(
      ['test("a-one, a-two and a-three: does it", async ({ page }) => {', '  it.skip("b-one (config defaults): takes defaults", () => {', 'test.describe("c-one: a group is not a test", () => {', "  const x = 1;"].join("\n"),
    );
    expect(tests.map((t) => [t.line, t.ids])).toEqual([
      [1, ["a-one", "a-two", "a-three"]],
      [2, ["b-one"]],
    ]);
  });
});
