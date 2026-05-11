import { cpSync, existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createStudioServer } from "./server.js";

const repoRoot = new URL("../../..", import.meta.url).pathname;

describe("AskDB Studio server", () => {
  const originalMockSql = process.env.ASKDB_MOCK_SQL;
  const servers: ReturnType<typeof createStudioServer>[] = [];

  afterEach(async () => {
    process.env.ASKDB_MOCK_SQL = originalMockSql;
    await Promise.all(
      servers.map(
        (server) =>
          new Promise<void>((resolve) => {
            server.close(() => resolve());
          }),
      ),
    );
    servers.length = 0;
  });

  it("loads, saves enrichment, and generates sample SQL with the mock model", async () => {
    const schemaDir = copyFixture();
    const server = createStudioServer({ schema: schemaDir });
    servers.push(server);
    const baseUrl = await listen(server);

    const workspace = await getJson(`${baseUrl}/api/workspace`);
    expect(workspace.schemaId).toBe("orders-users");
    expect(workspace.tables.length).toBeGreaterThan(0);

    const users = workspace.tables.find((table: any) => table.physical.name === "users");
    expect(users).toBeTruthy();

    const draft = users.draft;
    draft.description = "Application users who can place orders.";
    draft.aliases = ["customers", "accounts"];
    draft.commonQueryLanguage = "Use customers when the question says buyer.";
    draft.columns[users.physical.columns[0].id].description = "Stable user identifier.";

    const saved = await postJson(`${baseUrl}/api/tables/${encodeURIComponent(users.physical.id)}`, {
      draft,
    });
    expect(saved.tables.find((table: any) => table.physical.id === users.physical.id).draft.description).toBe(
      "Application users who can place orders.",
    );

    const usersMd = join(schemaDir, "tables", "users.md");
    expect(existsSync(usersMd)).toBe(true);
    expect(readFileSync(usersMd, "utf8")).toContain("Application users who can place orders.");

    process.env.ASKDB_MOCK_SQL = "select count(*) from users";
    const generated = await postJson(`${baseUrl}/api/ask`, {
      question: "How many users are there?",
    });
    expect(generated.sql).toBe("select count(*) from users");

    const initialRag = await getJson(`${baseUrl}/api/rag/status`);
    expect(initialRag.hasIndex).toBe(false);
    expect(initialRag.chunksTotal).toBeGreaterThan(0);

    const indexed = await postJson(`${baseUrl}/api/rag/index`, {});
    expect(indexed.stats.chunksTotal).toBeGreaterThan(0);
    expect(indexed.status.hasIndex).toBe(true);
    expect(indexed.status.stale).toBe(false);

    const retrieved = await postJson(`${baseUrl}/api/rag/query`, {
      question: "How many users are there?",
      k: 3,
      types: ["table", "column", "cql", "question", "concept"],
    });
    expect(retrieved.results.length).toBeGreaterThan(0);
    expect(retrieved.results[0].text).toEqual(expect.any(String));
  });
});

function copyFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "askdb-studio-"));
  const schemaDir = join(dir, "orders-users.schema");
  cpSync(join(repoRoot, "fixtures/schemas/orders-users.schema"), schemaDir, {
    recursive: true,
  });
  return schemaDir;
}

async function listen(server: ReturnType<typeof createStudioServer>): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Server did not bind a TCP port.");
  return `http://127.0.0.1:${address.port}`;
}

async function getJson(url: string): Promise<any> {
  const response = await fetch(url);
  expect(response.status).toBe(200);
  return response.json();
}

async function postJson(url: string, body: unknown): Promise<any> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(response.status).toBe(200);
  return response.json();
}
