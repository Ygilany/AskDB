import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

// Runs dist/index.js in a child process, as an embedding host would: turbo's `test` task
// depends on this package's `build`, so dist is current. A child process gives each case its
// own working directory and a fresh AskDB runtime.
const repoRoot = join(import.meta.dirname, "../../..");
const entry = pathToFileURL(join(repoRoot, "apps/http-api/dist/index.js")).href;
const schemaDir = join(repoRoot, "fixtures/schemas/orders-users.schema");

const scratchDirs: string[] = [];

/**
 * A project directory with an `askdb.config.ts` whose mock model answers `mockSql`.
 * `ownConfigCopy` installs a separate copy of `@askdb/config` for the host, as when the host's
 * version differs from the one `@askdb/http-api` depends on; otherwise both share one copy.
 * `logging` is the config's `logging` block (silent by default).
 */
function makeProject(
  mockSql: string,
  { ownConfigCopy = false, logging = { level: "silent" } as Record<string, unknown> } = {},
): string {
  const dir = mkdtempSync(join(tmpdir(), "askdb-http-host-"));
  scratchDirs.push(dir);
  // So `import "@askdb/config"` resolves, in askdb.config.ts and in the host script.
  mkdirSync(join(dir, "node_modules/@askdb"), { recursive: true });
  const configPackage = join(repoRoot, "packages/config");
  const hostConfig = join(dir, "node_modules/@askdb/config");
  if (ownConfigCopy) {
    mkdirSync(hostConfig);
    cpSync(join(configPackage, "package.json"), join(hostConfig, "package.json"));
    cpSync(join(configPackage, "dist"), join(hostConfig, "dist"), { recursive: true });
    symlinkSync(join(configPackage, "node_modules"), join(hostConfig, "node_modules"));
  } else {
    symlinkSync(configPackage, hostConfig);
  }
  writeFileSync(
    join(dir, "askdb.config.ts"),
    `import { defineConfig } from "@askdb/config";
export default defineConfig({
  ai: { provider: "openai", providerConfig: { openai: { apiKey: "" } } },
  introspection: { provider: "postgres", providerConfig: { postgres: {} } },
  rag: { embedder: "mock", store: "memory", storeConfig: { memory: {} } },
  host: { schemaPath: ${JSON.stringify(schemaDir)} },
  dev: { mockSql: ${JSON.stringify(mockSql)} },
  logging: ${JSON.stringify(logging)},
});
`,
  );
  return dir;
}

/**
 * Run `setup` as a host module in `cwd`, then build the server, start it and post one question.
 * Prints `{ status, body }` from `POST /ask`, or `{ thrown, exitCode }` when building the server
 * throws (`exitCode` is the host's `process.exitCode` at that point).
 */
function runHost(
  cwd: string,
  setup = "",
): { status?: number; body?: any; thrown?: string; exitCode?: number } {
  const script = `
import { createAskDbHttpServer } from ${JSON.stringify(entry)};
${setup}
let app;
try {
  app = createAskDbHttpServer({ port: 0 });
} catch (error) {
  process.stdout.write(JSON.stringify({ thrown: error.message, exitCode: process.exitCode }));
  process.exit(0);
}
await app.listen();
const { port } = app.server.address();
const res = await fetch(\`http://127.0.0.1:\${port}/ask\`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ question: "how many users?" }),
});
process.stdout.write(JSON.stringify({ status: res.status, body: await res.json() }));
await app.close();
`;
  const run = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd,
    encoding: "utf8",
    timeout: 30_000,
  });
  if (run.status !== 0) throw new Error(`host exited ${run.status}: ${run.stderr}`);
  return JSON.parse(run.stdout);
}

describe("createAskDbHttpServer config bootstrap", () => {
  afterEach(() => {
    for (const dir of scratchDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("loads askdb.config.* from the working directory when the host didn't bootstrap", () => {
    const project = makeProject("select 'from cwd'");

    const reply = runHost(project);

    expect(reply.status).toBe(200);
    expect(reply.body.sql).toBe("select 'from cwd'");
  });

  it("keeps the runtime a host bootstrapped first, even when the working directory has another config", () => {
    const hostProject = makeProject("select 'from host'");
    const cwdProject = makeProject("select 'from cwd'");

    const reply = runHost(
      cwdProject,
      `import { bootstrapAskDbEnv } from "@askdb/config";
bootstrapAskDbEnv({ cwd: ${JSON.stringify(hostProject)} });`,
    );

    expect(reply.status).toBe(200);
    expect(reply.body.sql).toBe("select 'from host'");
  });

  it("keeps the host's runtime when the host loads its own copy of @askdb/config", () => {
    const hostProject = makeProject("select 'from host'");
    const cwdProject = makeProject("select 'from cwd'", { ownConfigCopy: true });

    const reply = runHost(
      cwdProject,
      `import { bootstrapAskDbEnv } from "@askdb/config";
bootstrapAskDbEnv({ cwd: ${JSON.stringify(hostProject)} });`,
    );

    expect(reply.status).toBe(200);
    expect(reply.body.sql).toBe("select 'from host'");
  });

  it("throws the config error when it is built, not on the first request, when no config is found", () => {
    const empty = mkdtempSync(join(tmpdir(), "askdb-http-host-"));
    scratchDirs.push(empty);

    const reply = runHost(empty);

    expect(reply.thrown).toMatch(/^No askdb\.config\.\* or \.config\/askdb\.\* found under /);
  });

  it("throws when an existing .env can't be read, and leaves the host's exit code alone", () => {
    const project = makeProject("select 1");
    // A directory where `.env` should be: reading it fails with EISDIR, not ENOENT.
    mkdirSync(join(project, ".env"));

    const reply = runHost(project);

    expect(reply.thrown).toMatch(/^Failed to load \.env: /);
    expect(reply.exitCode).toBeUndefined();
  });
});

describe("createAskDbHttpServer logging", () => {
  afterEach(() => {
    for (const dir of scratchDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("keeps one log file open across requests, and logs each request with its correlation ID", () => {
    // A relative logFile resolves against the host's working directory, the project.
    const project = makeProject("select 1", { logging: { level: "info", logFile: "logs/askdb.log" } });
    // Malformed JSON is rejected with 400 before the pipeline runs, and each rejection is logged.
    const script = `
import { readdirSync } from "node:fs";
import { createAskDbHttpServer } from ${JSON.stringify(entry)};
const app = createAskDbHttpServer({ port: 0 });
await app.listen();
const { port } = app.server.address();
const post = (id) =>
  fetch(\`http://127.0.0.1:\${port}/ask\`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-correlation-id": id },
    body: "{",
  }).then((res) => res.text());
await post("req-0");
const before = readdirSync("/dev/fd").length;
for (let i = 1; i <= 40; i++) await post(\`req-\${i}\`);
const after = readdirSync("/dev/fd").length;
await app.close();
process.stdout.write(JSON.stringify({ opened: after - before }));
`;
    const run = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      cwd: project,
      encoding: "utf8",
      timeout: 30_000,
    });
    if (run.status !== 0) throw new Error(`host exited ${run.status}: ${run.stderr}`);
    const { opened } = JSON.parse(run.stdout) as { opened: number };

    expect(opened).toBeLessThan(5);
    const ids = readFileSync(join(project, "logs/askdb.log"), "utf8")
      .trim()
      .split("\n")
      .map((line) => (JSON.parse(line) as { correlationId: string }).correlationId);
    expect(ids).toEqual(Array.from({ length: 41 }, (_, i) => `req-${i}`));
  });
});
