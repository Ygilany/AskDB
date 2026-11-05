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

// These tests execute dist/cli.js; turbo's `test` task depends on this package's own
// `build` (and `^build`), so dist is current without rebuilding inside the tests —
// in-test rebuilds raced with parallel test files reading dist.
describe("cli spawn: rich errors", () => {
  it("defaults ask --schema to introspection.outputDir from config", () => {
    const repoRoot = join(import.meta.dirname, "../../..");
    const cliDir = join(repoRoot, "apps/cli");

    const exec = run(
      "node",
      [
        join(cliDir, "dist/cli.js"),
        "ask",
        "--question",
        "Which customers signed up last week?",
      ],
      {
        cwd: repoRoot,
        env: {
          ASKDB_MOCK_SQL: "SELECT 1",
          MY_INTROSPECT_OUTPUT_DIR: "fixtures/schemas/orders-users.schema/",
        },
      },
    );

    expect(exec.status).toBe(0);
    expect(exec.stderr).not.toContain("required option");
    expect(exec.stdout).toContain("-- sql --");
    expect(exec.stdout).toContain("-- sql --\nSELECT 1\n");
  });

  it("prints schema path + fixture hint when schema file is missing", () => {
    const repoRoot = join(import.meta.dirname, "../../..");
    const cliDir = join(repoRoot, "apps/cli");

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
    expect(exec.stderr).toContain("Schema path not found.");
    expect(exec.stderr).toContain("Schema path:");
    expect(exec.stderr).toContain("fixtures/schemas/orders-users.schema/");
  });

  it("prints schema path + details when schema JSON is invalid", () => {
    const repoRoot = join(import.meta.dirname, "../../..");
    const cliDir = join(repoRoot, "apps/cli");

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
      expect(exec.stderr).toContain("Failed to parse schema.");
      expect(exec.stderr).toContain(`Schema path: ${schemaFile}`);
      expect(exec.stderr).toContain("Details:");
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it("rejects the removed --execute option", () => {
    const repoRoot = join(import.meta.dirname, "../../..");
    const cliDir = join(repoRoot, "apps/cli");

    const exec = run(
      "node",
      [
        join(cliDir, "dist/cli.js"),
        "ask",
        "--schema",
        "fixtures/schemas/orders-users.schema/",
        "--question",
        "anything",
        "--execute",
      ],
      {
        cwd: repoRoot,
        env: {
          ASKDB_MOCK_SQL: "SELECT 1",
        },
      },
    );

    expect(exec.status).toBe(1);
    expect(exec.stderr).toContain("unknown option '--execute'");
  });
});

describe("cli spawn: askdb rag exits with runRagCli's code", () => {
  const repoRoot = join(import.meta.dirname, "../../..");
  const cliJs = join(repoRoot, "apps/cli/dist/cli.js");
  const schemaDir = "fixtures/schemas/orders-users.schema";

  it("exits 0 with the index summary on stdout", () => {
    // The memory store writes nothing, so the fixture's lock and files stay as they are.
    const exec = run("node", [cliJs, "rag", "index", schemaDir, "--store", "memory", "--embedder", "mock"], { cwd: repoRoot });
    expect(exec.stderr).toBe("");
    expect(exec.status).toBe(0);
    expect(JSON.parse(exec.stdout)).toMatchObject({ schemaId: "orders-users", chunksIndexed: expect.any(Number) });
  });

  it("exits 1 when the command fails", () => {
    const exec = run("node", [cliJs, "rag", "query", schemaDir, "--store", "memory", "--question", "x"], { cwd: repoRoot });
    expect(exec.status).toBe(1);
    expect(exec.stderr).toContain("the memory store lives only inside one process");
  });
});
