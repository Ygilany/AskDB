/**
 * The installed `askdb` binary, run the way a user runs it, against `reference/cli.mdx`:
 * `askdb ask` prints SQL on stdout and the sensitive `Warning:` on stderr, `--mock-sql`
 * bypasses the model, `askdb introspect` writes, prints or fails as documented, and the
 * exit codes are 0 (success), 1 (config, IO, generation, validation) and 2 (invalid CLI
 * arguments). Every command runs `node_modules/.bin/askdb` from the lab's install, never
 * the workspace build. The model is the lab's replay server, reached through the lab's
 * `askdb.config.ts` (`providerConfig.openai.baseUrl` reads `LAB_REPLAY_BASE_URL`).
 *
 * The authoring-gate answers are per scenario, above each `describe`. For all of them:
 * No production seam: only the installed bin, its documented flags and config, and the
 * documented `sensitive` flag in `schema.json` (`docs/contracts/schema-v2.md`).
 *
 * Needs the fixture (`pnpm fixture:up`) and an installed lab (`pnpm lab:use .`). It fails,
 * rather than skips, when either is missing.
 */
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensureArtifact, requireInstallTarget } from "../../src/artifacts.js";
import { hasCapability, needsCapability } from "../../src/capabilities.js";
import { SUPPORTED_DIALECTS, type SupportedDialect } from "../../src/dialects.js";
import { LOGICAL_SCHEMAS, compareToLogicalSchema, connectionUrl, type SchemaJson } from "../../src/fixture.js";
import { ASKDB_BIN, askdbInProject, introspectFixture, type CliRun } from "../../src/introspect.js";
import { loadQuestions, readCassette } from "../../src/model/catalog.js";
import { startReplayServer, type ReplayServer } from "../../src/model/replay-server.js";
import { LAB_ROOT } from "../../src/paths.js";

const QUESTIONS = loadQuestions();

let replay: ReplayServer;
let scratch: string;

beforeAll(async () => {
  requireInstallTarget();
  replay = await startReplayServer();
  scratch = mkdtempSync(join(tmpdir(), "lab-cli-"));
});

afterAll(async () => {
  await replay?.close();
  if (scratch) rmSync(scratch, { recursive: true, force: true });
});

/**
 * The installed `askdb`, from the lab's root (its `askdb.config.ts`), with the config's
 * model pointed at the replay server's `dialect`. Asynchronous, so the in-process replay
 * server can answer while it runs.
 */
function askdbCli(args: string[], dialect: SupportedDialect = "postgres"): Promise<CliRun> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, LAB_REPLAY_BASE_URL: replay.baseURL(dialect) };
    const child = spawn(ASKDB_BIN, args, { cwd: LAB_ROOT, env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

function cassetteSql(dialect: SupportedDialect, questionId: string): string {
  const cassette = readCassette(dialect, QUESTIONS.find((q) => q.id === questionId)!);
  return /```sql\n([\s\S]*?)\n```/.exec(cassette!.reply)![1]!;
}

/**
 * Contract: `askdb ask --schema <artifact> --question <q>` returns the validated SQL on
 * stdout and exits 0, with the model from `askdb.config.ts` and the dialect resolved from
 * the engine the artifact records (`reference/cli.mdx`, `askdb ask`).
 * Catches: a packed CLI that can't build the configured provider or reach its `baseUrl`,
 * that resolves the wrong dialect from an artifact and rejects valid dialect syntax
 * (brackets and `TOP` on SQL Server, backticks on MySQL and MariaDB), that prints the SQL
 * to stderr or not at all, or that exits non-zero on success.
 * Not covered elsewhere: `lab-ask-replay` calls `ask()` and `createAskDb` in-process with
 * an explicit dialect; `apps/cli`'s own tests spawn the workspace build. Neither runs the
 * packed bin with a config-driven model and an artifact-resolved dialect.
 */
describe.each(SUPPORTED_DIALECTS.map((d) => [d] as [SupportedDialect]))("[%s] cli-ask-replay", (dialect) => {
  const runs = new Map<string, CliRun>();

  beforeAll(async () => {
    // A target that can't build the artifact reports n/a in each test instead.
    if (!hasCapability("cli-introspect-engine")) return;
    const artifact = ensureArtifact(dialect);
    await Promise.all(
      QUESTIONS.map(async (q) => runs.set(q.id, await askdbCli(["ask", "--schema", artifact, "--question", q.text], dialect))),
    );
  });

  it.for(QUESTIONS.map((q) => q.id))("askdb ask prints the cassette's SQL for %s on stdout and exits 0", (id, ctx) => {
    needsCapability(ctx, "cli-introspect-engine");
    const run = runs.get(id)!;

    expect(run.stdout).toContain(cassetteSql(dialect, id));
    expect(run.stderr).not.toContain(cassetteSql(dialect, id));
    expect(run.status, run.stderr).toBe(0);
  });
});

/**
 * Contract: `--mock-sql <sql>` is "deterministic output for tests — bypasses the live model
 * call": the SQL goes to stdout, exit 0, and the configured model receives no request.
 * Catches: `--mock-sql` ignored (the configured model is called anyway), or the mock SQL
 * not reaching stdout.
 * Not covered elsewhere: the lab's other suites never pass `--mock-sql`; `apps/cli`'s tests
 * use it on the workspace build with no model configured, so they can't see a model call.
 */
describe("[postgres] cli-ask-mock-sql", () => {
  it("prints the --mock-sql SQL on stdout, exits 0 and sends the configured model nothing", async (ctx) => {
    needsCapability(ctx, "cli-introspect-engine");
    const sql = "SELECT agency_id, name FROM org.agency ORDER BY agency_id";
    const before = replay.requests().length;
    const run = await askdbCli(["ask", "--schema", ensureArtifact("postgres"), "--question", "List the agencies.", "--mock-sql", sql]);

    expect(run.stdout).toContain(sql);
    expect(replay.requests().length).toBe(before);
    expect(run.status, run.stderr).toBe(0);
  });
});

/**
 * Contract: when the SQL references a column the artifact marks `sensitive`, `askdb ask`
 * prints a `Warning:` line to stderr listing it and still prints the SQL on stdout, exit 0
 * (`reference/cli.mdx`; `sensitive` in `schema.json`, `docs/contracts/schema-v2.md`).
 * Catches: the warning dropped, moved to stdout (where it would corrupt piped SQL), or not
 * naming the column; the SQL withheld or the exit code changed on a warning; a warning on
 * SQL that reads no sensitive column.
 * Not covered elsewhere: core's tests check `sensitiveGuardrail` on the result object; no
 * test reads what the packed CLI prints for it.
 */
describe("[postgres] cli-ask-sensitive-warning", () => {
  let artifact: string;

  beforeAll(() => {
    artifact = join(scratch, "sensitive.schema");
    if (!hasCapability("cli-introspect-engine")) return;
    cpSync(ensureArtifact("postgres"), artifact, { recursive: true });
    const schemaFile = join(artifact, "schema.json");
    const schema = JSON.parse(readFileSync(schemaFile, "utf8")) as {
      tables: { schema: string; name: string; columns: { name: string; sensitive?: boolean }[] }[];
    };
    const client = schema.tables.find((t) => t.schema === "people" && t.name === "client")!;
    client.columns.find((c) => c.name === "ssn")!.sensitive = true;
    writeFileSync(schemaFile, JSON.stringify(schema, null, 2));
  });

  it("warns on stderr naming the sensitive column, still prints the SQL and exits 0", async (ctx) => {
    needsCapability(ctx, "cli-introspect-engine");
    const sql = "SELECT client_id, ssn FROM people.client";
    const run = await askdbCli(["ask", "--schema", artifact, "--question", "Show client SSNs.", "--mock-sql", sql]);

    expect(run.stderr).toMatch(/^Warning:.*\bssn\b/m);
    expect(run.stdout).not.toContain("Warning:");
    expect(run.stdout).toContain(sql);
    expect(run.status, run.stderr).toBe(0);
  });

  it("prints no warning for SQL that reads no sensitive column", async (ctx) => {
    needsCapability(ctx, "cli-introspect-engine");
    const sql = "SELECT client_id, full_name FROM people.client";
    const run = await askdbCli(["ask", "--schema", artifact, "--question", "Show client names.", "--mock-sql", sql]);

    expect(run.stderr).not.toContain("Warning:");
    expect(run.stdout).toContain(sql);
    expect(run.status, run.stderr).toBe(0);
  });
});

/**
 * Contract: exit code 1 is a generic error, including validation and IO
 * (`reference/cli.mdx`, "Exit codes"); errors print to stderr; `askdb ask` puts only
 * validated SQL on stdout.
 * Catches: rejected SQL printed on stdout (a pipeline would run it) or exiting 0; a missing
 * schema artifact exiting 0 or with a crash code; errors printed to stdout.
 * Not covered elsewhere: `lab-ask` checks rejection through `ask()` in-process, and exit 1
 * of `pnpm lab ask`, which is the lab's own CLI; nothing checks the packed `askdb`'s.
 */
describe("[postgres] cli-ask-exit-1", () => {
  it("exits 1 on SQL that fails validation, with the error on stderr and no SQL on stdout", async (ctx) => {
    needsCapability(ctx, "cli-introspect-engine");
    const run = await askdbCli(["ask", "--schema", ensureArtifact("postgres"), "--question", "Remove the agencies.", "--mock-sql", "DELETE FROM org.agency"]);

    expect(run.stdout).not.toContain("DELETE");
    expect(run.stderr).not.toBe("");
    expect(run.status).toBe(1);
  });

  it("exits 1 when the schema artifact doesn't exist, with the error on stderr", async () => {
    const run = await askdbCli(["ask", "--schema", join(scratch, "no-such.schema"), "--question", "List the agencies.", "--mock-sql", "SELECT 1"]);

    expect(run.stdout).not.toContain("SELECT 1");
    expect(run.stderr).not.toBe("");
    expect(run.status).toBe(1);
  });
});

/**
 * Contract: exit code 2 means invalid CLI arguments (`reference/cli.mdx`, "Exit codes"):
 * a missing required flag (`askdb ask` without `--question`) or an unknown one.
 * Catches: argument errors that can't be told apart from runtime failures, so a script
 * retries a typo, or treats a bad flag as a database outage.
 * Not covered elsewhere: no test checks the documented code 2. Today every argument error
 * exits 1, filed as #287, so these are `it.fails` until the docs or the CLI change.
 */
describe("[postgres] cli-exit-2", () => {
  it.fails("askdb ask without --question exits 2 (#287)", async () => {
    const run = await askdbCli(["ask", "--mock-sql", "SELECT 1"]);
    expect(run.status).toBe(2);
  });

  it.fails("askdb ask with an unknown flag exits 2 (#287)", async () => {
    const run = await askdbCli(["ask", "--question", "List the agencies.", "--mock-sql", "SELECT 1", "--no-such-flag"]);
    expect(run.status).toBe(2);
  });

  it.fails("askdb introspect with an unknown flag exits 2 (#287)", async () => {
    const run = await askdbCli(["introspect", "--no-such-flag"]);
    expect(run.status).toBe(2);
  });
});

/** The fixture's URL with the read-only role's password replaced. */
function wrongPassword(dialect: Exclude<SupportedDialect, "sqlite">): string {
  return connectionUrl(dialect, "reader")
    .replace(/^(\w+:\/\/[^:/@]+:)[^@]*@/, "$1wrong-password@")
    .replace(/Password=[^;]*/, "Password=wrong-password");
}

/**
 * Contract: `askdb introspect` that can't read the database exits 1, prints the error on
 * stderr and writes no artifact (`reference/cli.mdx`, "Exit codes").
 * Catches: a connector that swallows a login failure (or opens a missing SQLite file as a
 * new empty database) and writes an empty artifact with exit 0, which `askdb ask` would
 * then happily use.
 * Not covered elsewhere: `introspection.test.ts` covers exit 0 and the artifact; the
 * connectors' integration tests call them in-process with valid credentials.
 */
describe.each(SUPPORTED_DIALECTS.map((d) => [d] as [SupportedDialect]))("[%s] cli-introspect-exit-1", (dialect) => {
  it(`exits 1 and writes nothing when ${dialect === "sqlite" ? "the database file is missing" : "the password is wrong"}`, (ctx) => {
    needsCapability(ctx, "cli-introspect-engine");
    const out = join(scratch, `unreachable-${dialect}.schema`);
    const run =
      dialect === "sqlite"
        ? introspectFixture(dialect, out, { sqliteFile: join(scratch, "missing.sqlite") })
        : introspectFixture(dialect, out, { url: wrongPassword(dialect) });

    expect(run.stderr).not.toBe("");
    expect(existsSync(out)).toBe(false);
    expect(run.status).toBe(1);
  });
});

/**
 * Contract: `askdb introspect` writes the artifact to `--out`, which "falls back to
 * `introspection.outputDir` in `askdb.config.ts`", and `--print` prints the introspection
 * result without writing (`reference/cli.mdx`).
 * Catches: the `outputDir` fallback lost (the command fails or writes elsewhere), `--print`
 * writing to the configured directory anyway, or printing something other than the schema.
 * Not covered elsewhere: every other lab introspection passes `--out`; `apps/cli`'s tests
 * run the workspace build.
 */
describe("[postgres] cli-introspect-output", () => {
  const introspection = { provider: "postgres", providerConfig: { postgres: {} }, outputDir: "./configured-out" };
  const args = ["introspect", "--engine", "postgres", "--url", connectionUrl("postgres", "reader"), "--schemas", LOGICAL_SCHEMAS.join(",")];

  it("writes to introspection.outputDir when no output flag is given", (ctx) => {
    needsCapability(ctx, "cli-introspect-engine");
    const run = askdbInProject(introspection, args);

    expect(run.status, run.stderr).toBe(0);
    expect(run.files).toEqual(["configured-out"]);
  });

  it("--print prints the schema on stdout and writes nothing", (ctx) => {
    needsCapability(ctx, "cli-introspect-engine");
    const run = askdbInProject(introspection, [...args, "--print"]);

    expect(run.status, run.stderr).toBe(0);
    expect(run.files).toEqual([]);
    expect(compareToLogicalSchema(JSON.parse(run.stdout) as SchemaJson, { expectNamespaces: true })).toEqual([]);
  });
});
