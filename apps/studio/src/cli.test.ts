import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

// Runs the published bin over dist/: turbo's `test` task depends on this package's `build`.
const repoRoot = join(import.meta.dirname, "../../..");
const bin = join(import.meta.dirname, "../bin/askdb-studio.js");

/**
 * Names a user might set in the shell that AskDB never reads from there. Settings come from
 * askdb.config.ts (bound to a variable with `env("…")`); `ASKDB_DEBUG` is the one AskDB variable
 * read from the environment, so it's allowed.
 */
const UNREAD_ENV_NAME = /\b(?:ASKDB_(?!DEBUG\b)[A-Z0-9_]+|DATABASE_URL|OPENAI_API_KEY|OPENAI_MODEL)\b/;

it("`askdb-studio --help` names the askdb.config keys, not environment variables nothing reads (#281)", () => {
  const emptyDir = mkdtempSync(join(tmpdir(), "askdb-studio-help-"));
  try {
    const exec = spawnSync("node", [bin, "--help"], { cwd: emptyDir, encoding: "utf8" });
    expect(exec.status, exec.stderr).toBe(0);
    expect(exec.stdout).not.toMatch(UNREAD_ENV_NAME);
    for (const key of ["introspection.outputDir", "studio.listen.port", "studio.listen.host", "ai.providerConfig"]) {
      expect(exec.stdout).toContain(key);
    }
  } finally {
    rmSync(emptyDir, { recursive: true, force: true });
  }
});

it("refuses a studio.listen.port outside 1-65535 instead of binding the default port", () => {
  const project = mkdtempSync(join(tmpdir(), "askdb-studio-port-"));
  try {
    // So `import "@askdb/config"` in askdb.config.ts resolves when Studio loads it.
    mkdirSync(join(project, "node_modules/@askdb"), { recursive: true });
    symlinkSync(join(repoRoot, "packages/config"), join(project, "node_modules/@askdb/config"));
    writeFileSync(
      join(project, "askdb.config.ts"),
      `import { defineConfig } from "@askdb/config";
export default defineConfig({
  ai: { provider: "openai", providerConfig: { openai: {} } },
  introspection: { provider: "postgres", providerConfig: { postgres: {} } },
  studio: { listen: { port: 70000 } },
});
`,
    );
    // Before the fix Studio started on 5556 and kept running; the timeout ends that case.
    const exec = spawnSync("node", [bin], { cwd: project, encoding: "utf8", timeout: 10_000 });
    expect(exec.status).toBe(1);
    expect(exec.stderr).toContain("Invalid studio.listen.port in askdb.config: 70000 (expected an integer from 1 to 65535).");
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
}, 15_000);
