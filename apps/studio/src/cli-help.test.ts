import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

// Runs the published bin over dist/: turbo's `test` task depends on this package's `build`.
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
