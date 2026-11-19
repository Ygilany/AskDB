import { globSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadAskDbConfigProjection } from "./index.js";

const root = resolve(import.meta.dirname, "../../..");
const examples = globSync("examples/**/askdb.config.ts", {
  cwd: root,
  exclude: ["**/node_modules/**", "**/dist/**", "**/.lab/**"],
}).sort();

describe("example configurations", () => {
  it.each(examples)("loads %s", async (example) => {
    const path = resolve(root, example);
    const { path: loadedPath, projection } = await loadAskDbConfigProjection(dirname(path));

    expect(loadedPath).toBe(path);
    expect(projection).toBeDefined();
  });
});
