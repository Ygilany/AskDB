import { globSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { loadAskDbConfigProjection, resetAskDbRuntimeForTests } from "./index.js";
import { linkWorkspacePackage } from "./test-utils.js";

// #747: `examples/express-server/askdb.config.ts` once failed to load and nobody
// noticed, because nothing in CI loads the example configs. Load every
// `examples/*/askdb.config.ts` through the config loader, so a broken example
// config fails CI. The glob finds a new example's config without being edited.
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const EXAMPLE_CONFIGS = globSync("examples/**/askdb.config.ts", { cwd: repoRoot }).sort();

describe("example configs (#747)", () => {
  afterEach(() => {
    resetAskDbRuntimeForTests();
  });

  it("loads every examples/*/askdb.config.ts", async () => {
    // A glob that matches nothing must not pass silently.
    expect(EXAMPLE_CONFIGS.length).toBeGreaterThan(0);
    for (const rel of EXAMPLE_CONFIGS) {
      const dir = join(repoRoot, dirname(rel));
      let projection;
      try {
        ({ projection } = await loadAskDbConfigProjection(dir));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to load example config ${rel}: ${message}`, { cause: error });
      }
      expect(projection, `expected ${rel} to load`).toBeDefined();
    }
  });

  it("fails when an example config is broken, naming the file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "askdb-example-config-"));
    try {
      linkWorkspacePackage(dir);
      const source = readFileSync(join(repoRoot, "examples/express-server/askdb.config.ts"), "utf8");
      // Drop the required `ai` block: rename its key so the config no longer has one.
      const broken = source.replace('  ai: {', '  aiRemoved: {');
      expect(broken).not.toBe(source);
      writeFileSync(join(dir, "askdb.config.ts"), broken, "utf8");
      await expect(loadAskDbConfigProjection(dir)).rejects.toThrow(
        `AskDB config at ${join(dir, "askdb.config.ts")}: the config has no ai block;`,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
