import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AskDbLogEvent } from "@askdb/core";

// Runs dist/cli.js: turbo's `test` task depends on this package's `build`, so dist is current.
const repoRoot = join(import.meta.dirname, "../../..");
const cli = join(repoRoot, "apps/cli/dist/cli.js");
const schemaPath = join(repoRoot, "fixtures/schemas/orders-users-sensitive.schema");
const SENSITIVE_COLUMN = "secret_recovery_token";

/** A fake OpenAI Responses endpoint that answers `SELECT id FROM users` and records each request body. */
async function startFakeProvider() {
  const bodies: string[] = [];
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    bodies.push(Buffer.concat(chunks).toString("utf8"));
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        id: "resp_test",
        object: "response",
        created_at: 0,
        model: "gpt-4o-mini",
        status: "completed",
        incomplete_details: null,
        output: [
          {
            type: "message",
            id: "msg_test",
            status: "completed",
            role: "assistant",
            content: [{ type: "output_text", text: "```sql\nSELECT id FROM users\n```", annotations: [] }],
          },
        ],
        usage: {
          input_tokens: 1,
          input_tokens_details: { cached_tokens: 0 },
          output_tokens: 1,
          output_tokens_details: { reasoning_tokens: 0 },
          total_tokens: 2,
        },
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("expected inet address");
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    bodies,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/**
 * `askdb ask` from a scratch project whose config sets `modes`, plus any extra flags.
 * Returns the request body the model got and the mode core logged on `askdb.pipeline.mode`.
 */
async function askInProject(modes: string, flags: string[] = []): Promise<{ prompt: string; pipelineMode: unknown }> {
  const provider = await startFakeProvider();
  const project = mkdtempSync(join(tmpdir(), "askdb-cli-config-modes-"));
  try {
    // So `import "@askdb/config"` in askdb.config.ts resolves when the CLI loads it.
    mkdirSync(join(project, "node_modules/@askdb"), { recursive: true });
    symlinkSync(join(repoRoot, "packages/config"), join(project, "node_modules/@askdb/config"));
    writeFileSync(
      join(project, "askdb.config.ts"),
      `import { defineConfig } from "@askdb/config";
export default defineConfig({
  ai: { provider: "openai", providerConfig: { openai: { apiKey: "sk-test", baseUrl: ${JSON.stringify(provider.baseUrl)} } }, language: { model: "gpt-4o-mini" } },
  introspection: { provider: "postgres", providerConfig: { postgres: {} } },
  rag: { embedder: "mock", store: "memory", storeConfig: { memory: {} } },
  modes: ${modes},
});
`,
    );
    const logFile = join(project, "run.log");
    const args = [cli, "ask", "--schema", schemaPath, "--question", "list users", "--log-file", logFile, "--log-level", "info", ...flags];
    const child = spawn("node", args, { cwd: project });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    const status = await new Promise<number | null>((resolve) => child.on("close", resolve));
    expect(status, stderr).toBe(0);
    expect(provider.bodies).toHaveLength(1);
    const modeLines = readFileSync(logFile, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((entry) => entry.event === AskDbLogEvent.PipelineMode);
    expect(modeLines).toHaveLength(1);
    return { prompt: provider.bodies[0]!, pipelineMode: modeLines[0]!.mode };
  } finally {
    rmSync(project, { recursive: true, force: true });
    await provider.close();
  }
}

describe("cli spawn: config modes.omitSensitiveFromPrompt", () => {
  it("leaves sensitive columns out of the prompt with no flag when the config turns omission on", async () => {
    expect((await askInProject("{ omitSensitiveFromPrompt: true }")).prompt).not.toContain(SENSITIVE_COLUMN);
    // Control: the same schema and question name the column when neither config nor flag omits.
    expect((await askInProject("{}")).prompt).toContain(SENSITIVE_COLUMN);
  }, 30_000);
});

describe("cli spawn: config modes.askdbMode", () => {
  it("runs the config mode with no --mode flag, and --mode can tighten it", async () => {
    expect((await askInProject('{ askdbMode: "bounded_results" }')).pipelineMode).toBe("bounded_results");
    expect((await askInProject('{ askdbMode: "bounded_results" }', ["--mode", "schema_only"])).pipelineMode).toBe("schema_only");
  }, 30_000);
});
