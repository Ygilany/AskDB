import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

function run(command: string, args: string[], opts: { cwd: string; env?: NodeJS.ProcessEnv }) {
  return spawnSync(command, args, {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    encoding: "utf8",
  });
}

describe("cli spawn: rich errors", () => {
  it("prints schema path + fixture hint when schema file is missing", () => {
    const repoRoot = join(import.meta.dirname, "../../..");
    const cliDir = join(repoRoot, "packages/cli");

    const build = run("pnpm", ["-C", cliDir, "build"], { cwd: repoRoot });
    expect(build.status).toBe(0);

    const exec = run(
      "node",
      [
        join(cliDir, "dist/cli.js"),
        "ask",
        "--schema",
        "definitely-does-not-exist.schema.json",
        "--question",
        "anything",
      ],
      {
        cwd: repoRoot,
        env: {
          ASKDB_MOCK_SQL: "SELECT 1",
        },
      },
    );

    expect(exec.status).toBe(1);
    expect(exec.stderr).toContain("Schema file not found.");
    expect(exec.stderr).toContain("Schema path:");
    expect(exec.stderr).toContain("fixtures/schemas/orders-users.schema.json");
  });

  it("prints schema path + details when schema JSON is invalid", () => {
    const repoRoot = join(import.meta.dirname, "../../..");
    const cliDir = join(repoRoot, "packages/cli");

    const build = run("pnpm", ["-C", cliDir, "build"], { cwd: repoRoot });
    expect(build.status).toBe(0);

    const workDir = mkdtempSync(join(tmpdir(), "askdb-cli-schema-"));
    const schemaFile = join(workDir, "bad.schema.json");
    writeFileSync(schemaFile, "{ this is not json }", "utf8");

    try {
      const exec = run(
        "node",
        [
          join(cliDir, "dist/cli.js"),
          "ask",
          "--schema",
          schemaFile,
          "--question",
          "anything",
        ],
        {
          cwd: repoRoot,
          env: {
            ASKDB_MOCK_SQL: "SELECT 1",
          },
        },
      );

      expect(exec.status).toBe(1);
      expect(exec.stderr).toContain("Failed to parse schema JSON.");
      expect(exec.stderr).toContain(`Schema path: ${schemaFile}`);
      expect(exec.stderr).toContain("Details:");
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });
});

