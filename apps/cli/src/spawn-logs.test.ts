import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { ASKDB_LOG_REQUIRED_EVENTS, ASKDB_LOG_REQUIRED_FIELDS, AskDbLogEvent } from "@askdb/core";

function run(command: string, args: string[], opts: { cwd: string; env?: NodeJS.ProcessEnv }) {
  return spawnSync(command, args, {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    encoding: "utf8",
  });
}

describe("cli spawn: structured logs contract", () => {
  it("emits JSONL logs with required fields + events (no live LLM)", () => {
    const repoRoot = join(import.meta.dirname, "../../..");
    const cliDir = join(repoRoot, "apps/cli");

    // Ensure dist exists and contains current code. (Vitest excludes dist from test discovery, but we can still execute it.)
    const build = run("pnpm", ["-C", cliDir, "build"], { cwd: repoRoot });
    expect(build.status).toBe(0);

    const workDir = mkdtempSync(join(tmpdir(), "askdb-cli-spawn-"));
    const logDir = join(workDir, "logs");
    mkdirSync(logDir, { recursive: true });
    const logFile = join(logDir, "run.log");

    const schemaPath = join(repoRoot, "fixtures/schemas/orders-users-sensitive.schema");
    const mockSql = "SELECT users.secret_recovery_token FROM users";

    const exec = run(
      "node",
      [
        join(cliDir, "dist/cli.js"),
        "ask",
        "--schema",
        schemaPath,
        "--question",
        "return one",
        "--log-file",
        logFile,
        "--log-level",
        "info",
      ],
      {
        cwd: repoRoot,
        env: {
          ASKDB_MOCK_SQL: mockSql,
          // Make correlation deterministic for assertion/debugging.
          ASKDB_CORRELATION_ID: "spawn-test-correlation",
        },
      },
    );

    try {
      expect(exec.status).toBe(0);
      expect(exec.stderr).not.toContain("OPENAI_API_KEY is required");
      expect(exec.stderr).toContain("Warning: generated SQL references sensitive columns:");

      const lines = readFileSync(logFile, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean);
      expect(lines.length).toBeGreaterThan(0);

      const records = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
      for (const rec of records) {
        for (const field of ASKDB_LOG_REQUIRED_FIELDS) {
          expect(rec[field]).toBeTruthy();
        }
      }

      const events = new Set(records.map((r) => r.event).filter(Boolean));
      for (const evt of ASKDB_LOG_REQUIRED_EVENTS) {
        expect(events.has(evt)).toBe(true);
      }

      // Bonus: we should never crash before generation completes in mock mode.
      expect(events.has(AskDbLogEvent.RunError)).toBe(false);

      // The warning now comes from core's guardrail, logged through the CLI logger.
      expect(events.has(AskDbLogEvent.PipelineSensitiveSqlWarning)).toBe(true);
      const warning = records.find(
        (r) => r.event === AskDbLogEvent.PipelineSensitiveSqlWarning,
      )!;
      expect(warning.sensitiveColumnCount).toBe(1);
      expect(warning.sensitiveColumns).toEqual(["public.users.secret_recovery_token"]);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it("does not warn on a query that never reaches a sensitive column", () => {
    const repoRoot = join(import.meta.dirname, "../../..");
    const cliDir = join(repoRoot, "apps/cli");

    const build = run("pnpm", ["-C", cliDir, "build"], { cwd: repoRoot });
    expect(build.status).toBe(0);

    const schemaPath = join(repoRoot, "fixtures/schemas/orders-users-sensitive.schema");

    const exec = run(
      "node",
      [
        join(cliDir, "dist/cli.js"),
        "ask",
        "--schema",
        schemaPath,
        "--question",
        "order totals",
      ],
      {
        cwd: repoRoot,
        env: {
          // `id` exists on both orders and the sensitive-column-bearing users table.
          // The old bare-word matcher would have had to flag this; scope resolution does not.
          ASKDB_MOCK_SQL: "SELECT o.id, o.total_cents FROM orders o",
          ASKDB_CORRELATION_ID: "spawn-test-clean",
        },
      },
    );

    expect(exec.status).toBe(0);
    expect(exec.stderr).not.toContain("Warning: generated SQL references sensitive columns");
    expect(exec.stdout).toContain("SELECT o.id, o.total_cents FROM orders o;");
  });
});

