/**
 * The installed Studio server (`askdb studio`, from the lab's install target), driven over
 * HTTP the way a browser page, a rebound page or another site would drive it.
 *
 * The contract is ADR 0009 (`docs/adrs/0009-studio-local-api-protection.md`) and
 * `studio.mdx` ("Security model", "Playground"): a per-launch session token injected into
 * the served page and required as `x-askdb-studio-token` on every `/api/*` request (`403`
 * without the right one); a `Host` allowlist on every request, the page included (`403`
 * otherwise); a same-origin `Origin` check on state-changing `/api/*` requests (`403`); and
 * `Content-Type: application/json` on requests with a body (`415`). With `studio.execute`
 * enabled, `POST /api/execute` runs the read-only SELECT check before the driver, so a
 * write or a second statement is rejected with `400`, even when Studio holds the owner's
 * credentials.
 *
 * The authoring-gate answers are per scenario, above each `describe`. For all of them:
 * No production seam: only the installed `askdb studio` bin and its documented flags, the
 * documented `studio.execute` config, the routes and headers ADR 0009 and `studio.mdx` name,
 * and the token read from the served page as the browser app reads it. The request body
 * `{ sql }` and the `{ ok, columns, rows }` reply are the served app's own; no document
 * names them.
 * Each rejection is one header (or one statement) away from a request the same test shows
 * is accepted, so it can only come from the protection the case targets: every other
 * guard is satisfied (a valid token, Studio's own `Host`, its own `Origin`, JSON).
 *
 * The protection scenarios are engine-independent and run once, as `[postgres]`. The
 * execute scenarios run on every engine Studio's execute supports: all five (MariaDB
 * through the `mysql` provider, as `studio.mdx` describes). Each engine's Studio runs its
 * queries as the engine's owner on a scratch copy of the fixture (`src/scratch.ts`), never
 * on the fixture's own databases.
 *
 * Needs the fixture (`pnpm fixture:up`) and an installed lab (`pnpm lab:use .`). Targets
 * older than the request guard or the execute guard report `n/a` (`studio-request-guard`,
 * `studio-execute-guard` in `src/capabilities.ts`).
 */
import { afterAll, describe, expect, it, type TestContext } from "vitest";
import { ensureArtifact } from "../../src/artifacts.js";
import { needsCapability } from "../../src/capabilities.js";
import { SUPPORTED_DIALECTS, type SupportedDialect } from "../../src/dialects.js";
import { loadRows } from "../../src/fixture.js";
import { createScratch, scalar, withOwner, type ScratchDb } from "../../src/scratch.js";
import { TOKEN_HEADER, pageToken, startStudio, studioRequest, type StudioExecute, type StudioReply, type StudioServer } from "../../src/studio.js";

const AGENCIES = loadRows({ schema: "org", name: "agency" });
const ORDER_LINES = loadRows({ schema: "billing", name: "order_line" });

/** `studio.execute.provider` per engine (`reference/config.mdx`); MariaDB runs on `mysql`. */
const EXECUTE_PROVIDER: Record<SupportedDialect, StudioExecute["provider"]> = {
  postgres: "postgres",
  mysql: "mysql",
  mariadb: "mysql",
  sqlserver: "sqlserver",
  sqlite: "sqlite",
};

interface Launched {
  server: StudioServer;
  scratch: ScratchDb;
  /** The session token, read from the served page as the browser app reads it. */
  token: string | undefined;
}

const scratches = new Map<SupportedDialect, Promise<ScratchDb>>();
const launches = new Map<string, Promise<Launched>>();

afterAll(async () => {
  await Promise.all([...launches.values()].map((l) => l.then((running) => running.server.close(), () => {})));
  await Promise.all([...scratches.values()].map((s) => s.then((db) => db.drop(), () => {})));
});

function scratchFor(dialect: SupportedDialect): Promise<ScratchDb> {
  if (!scratches.has(dialect)) scratches.set(dialect, createScratch(dialect));
  return scratches.get(dialect)!;
}

/**
 * The dialect's Studio, with `studio.execute` on the dialect's scratch copy as its owner:
 * started on first use, after the test's capability gates, and killed in `afterAll`.
 * `launch` names a separate launch with the same config.
 */
async function studioFor(ctx: TestContext, dialect: SupportedDialect, opts: { guard?: boolean; launch?: string } = {}): Promise<Launched> {
  needsCapability(ctx, "cli-introspect-engine");
  if (opts.guard) await needsCapability(ctx, "studio-request-guard");
  // Every Studio here has execute on: the protection cases send their requests to /api/execute.
  await needsCapability(ctx, "studio-execute-guard");
  const key = `${dialect}:${opts.launch ?? "main"}`;
  if (!launches.has(key)) {
    launches.set(
      key,
      (async () => {
        const scratch = await scratchFor(dialect);
        const server = await startStudio({
          schema: ensureArtifact(dialect),
          execute: { provider: EXECUTE_PROVIDER[dialect], databaseUrl: scratch.url, file: scratch.file },
        });
        return { server, scratch, token: pageToken((await studioRequest(server)).text) };
      })(),
    );
  }
  return launches.get(key)!;
}

/**
 * Headers for an `/api/*` request as Studio's own page sends it: its token, and for a POST
 * its own `Origin` and JSON. `change` replaces a header, or removes it when `undefined`.
 */
function pageHeaders(l: Launched, method: "GET" | "POST", change: Record<string, string | undefined> = {}): Record<string, string> {
  const headers: Record<string, string | undefined> = { [TOKEN_HEADER]: l.token };
  if (method === "POST") Object.assign(headers, { origin: l.server.origin, "content-type": "application/json" });
  Object.assign(headers, change);
  return Object.fromEntries(Object.entries(headers).filter((e): e is [string, string] => e[1] !== undefined));
}

/** `GET /api/workspace`: a read, so only the Host and token checks apply. */
function getWorkspace(l: Launched, change?: Record<string, string | undefined>): Promise<StudioReply> {
  return studioRequest(l.server, { path: "/api/workspace", headers: pageHeaders(l, "GET", change) });
}

/** `POST /api/execute` with `{ sql }`. */
function execute(l: Launched, sql: string, change?: Record<string, string | undefined>): Promise<StudioReply> {
  return studioRequest(l.server, { method: "POST", path: "/api/execute", headers: pageHeaders(l, "POST", change), body: JSON.stringify({ sql }) });
}

/** `POST /api/execute` ran the SQL and returned rows. */
function expectRan(reply: StudioReply): void {
  expect(reply.json, reply.text).toMatchObject({ ok: true, rows: expect.any(Array) });
  expect(reply.status).toBe(200);
}

/**
 * Contract: each launch generates a random token and injects it into the page it serves;
 * every `/api/*` call without the right token gets `403`, and restarting Studio issues a
 * new one (`studio.mdx`; ADR 0009: `<meta name="askdb-studio-token">`, 256 bits, hex).
 * Catches: a packed Studio that serves no token (the browser app then gets `403` on every
 * call), accepts a request without one, or accepts another launch's token (a fixed or
 * reused token, which a stale tab or another page could hold).
 * Not covered elsewhere: `apps/studio`'s server tests run workspace source in-process and
 * read the token from `StudioServer.sessionToken`; nothing reads it from the page the
 * packed bin serves, which is the only way the browser app gets it (#328, item 2).
 */
describe("[postgres] studio-token", () => {
  it("the served page carries the launch's session token, and another launch's page carries another", async (ctx) => {
    const a = await studioFor(ctx, "postgres", { guard: true });
    const b = await studioFor(ctx, "postgres", { guard: true, launch: "second" });
    const page = await studioRequest(a.server);

    expect(page.headers["content-type"]).toMatch(/^text\/html/);
    expect(page.status).toBe(200);
    expect(pageToken(page.text)).toMatch(/^[0-9a-f]{64}$/);
    expect(b.token).toMatch(/^[0-9a-f]{64}$/);
    expect(b.token).not.toBe(a.token);
  });

  it("an /api request without x-askdb-studio-token answers 403; with the page's token it answers 200", async (ctx) => {
    const l = await studioFor(ctx, "postgres", { guard: true });

    expect((await getWorkspace(l, { [TOKEN_HEADER]: undefined })).status).toBe(403);
    expect((await getWorkspace(l)).status).toBe(200);
  });

  it("another launch's token answers 403, on each launch", async (ctx) => {
    const a = await studioFor(ctx, "postgres", { guard: true });
    const b = await studioFor(ctx, "postgres", { guard: true, launch: "second" });

    expect((await getWorkspace(a, { [TOKEN_HEADER]: b.token })).status).toBe(403);
    expect((await getWorkspace(b, { [TOKEN_HEADER]: a.token })).status).toBe(403);
    expect((await getWorkspace(a)).status).toBe(200);
    expect((await getWorkspace(b)).status).toBe(200);
  });
});

/**
 * Contract: Studio accepts only a `Host` of `localhost`, `127.0.0.1`, `[::1]` or the host
 * it was bound to, and only on its own port, on every request including the page; anything
 * else gets `403`, which blocks DNS rebinding (`studio.mdx`; ADR 0009, decision 1).
 * Catches: a packed Studio that drops the Host check, applies it to `/api/*` but not to the
 * page (a rebound page could then read the token), ignores the port, or rejects the
 * loopback names the docs allow.
 * Not covered elsewhere: `apps/studio`'s server tests check spoofed hosts on workspace
 * source in-process; nothing checks the packed bin's listener, where the port it
 * compares with is the one the CLI bound.
 */
describe("[postgres] studio-host", () => {
  it("a rebound Host answers 403 on the page and on /api with a valid token; 127.0.0.1 and localhost on Studio's port answer 200", async (ctx) => {
    const l = await studioFor(ctx, "postgres", { guard: true });
    const rebound = `evil.example:${l.server.port}`;

    const page = await studioRequest(l.server, { headers: { host: rebound } });
    expect(page.status).toBe(403);
    expect(page.text).not.toContain(l.token!);
    expect((await getWorkspace(l, { host: rebound })).status).toBe(403);

    for (const host of [l.server.host, `localhost:${l.server.port}`]) {
      expect((await studioRequest(l.server, { headers: { host } })).status, host).toBe(200);
      expect((await getWorkspace(l, { host })).status, host).toBe(200);
    }
  });

  it("127.0.0.1 on another port answers 403", async (ctx) => {
    const l = await studioFor(ctx, "postgres", { guard: true });
    const otherPort = l.server.port === 65535 ? l.server.port - 1 : l.server.port + 1;

    expect((await getWorkspace(l, { host: `127.0.0.1:${otherPort}` })).status).toBe(403);
    expect((await getWorkspace(l, { host: `127.0.0.1:${l.server.port}` })).status).toBe(200);
  });
});

/**
 * Contract: Studio rejects state-changing API requests whose `Origin` points at another
 * site (`studio.mdx`; ADR 0009, decision 2: `403`).
 * Catches: a packed Studio whose only defense against a cross-site `POST /api/execute` is
 * the token, so a page that learned or guessed one (or a future token bug) could run SQL.
 * Not covered elsewhere: only `apps/studio`'s in-process server tests send a foreign
 * `Origin`, on workspace source.
 */
describe("[postgres] studio-origin", () => {
  it("POST /api/execute from a cross-site Origin, with a valid token and JSON, answers 403; from Studio's own origin, 200", async (ctx) => {
    const l = await studioFor(ctx, "postgres", { guard: true });

    expect((await execute(l, "SELECT 1 AS ok", { origin: "http://evil.example" })).status).toBe(403);
    expectRan(await execute(l, "SELECT 1 AS ok"));
  });
});

/**
 * Contract: API requests whose body isn't `Content-Type: application/json` are rejected
 * with `415` (`studio.mdx`; ADR 0009, decision 2). ADR 0009's attack is exactly this: a
 * `no-cors` `text/plain` `fetch` to `/api/execute` needs no CORS preflight.
 * Catches: a packed Studio that parses any body as JSON, which lets a simple cross-site
 * request through without the preflight Studio never answers.
 * Not covered elsewhere: only `apps/studio`'s in-process server tests, on workspace source.
 */
describe("[postgres] studio-content-type", () => {
  it("POST /api/execute as text/plain, with a valid token and its own origin, answers 415; the same body as application/json, 200", async (ctx) => {
    const l = await studioFor(ctx, "postgres", { guard: true });

    expect((await execute(l, "SELECT 1 AS ok", { "content-type": "text/plain" })).status).toBe(415);
    expectRan(await execute(l, "SELECT 1 AS ok"));
  });
});

const lineCount = (s: ScratchDb) => withOwner(s, (c) => scalar(c, `SELECT COUNT(*) AS n FROM ${s.table({ schema: "billing", name: "order_line" })}`));

/**
 * `sql`, sent to Studio's execute, is refused with `400` and leaves `billing.order_line`
 * as seeded; the same SQL, run raw as the owner on the same scratch copy, empties it.
 */
async function expectRefusedThoughItWouldLand(l: Launched, sql: string): Promise<void> {
  await l.scratch.reset();
  const reply = await execute(l, sql);

  expect(reply.status, reply.text).toBe(400);
  expect(reply.json).not.toHaveProperty("rows");
  expect(await lineCount(l.scratch), "Studio's refused request changed the scratch copy").toBe(ORDER_LINES.length);
  // The proof: the refusal is what stood in the way. As the owner, the same SQL lands.
  await withOwner(l.scratch, (c) => c.run(sql));
  expect(await lineCount(l.scratch), "the SQL, run raw as the owner, didn't delete the rows").toBe(0);
}

describe.each(SUPPORTED_DIALECTS.map((d) => [d] as [SupportedDialect]))("[%s]", (dialect) => {
  /**
   * Contract: with `studio.execute` enabled, `POST /api/execute` runs a SELECT on the
   * configured connection and returns its rows (`studio.mdx`, "Playground").
   * Catches: a packed Studio that can't load the engine's driver from the project, can't
   * use the documented connection (`databaseUrl`, or `file` for SQLite), breaks the query
   * with its row-cap wrapper, or loses or mangles rows (unicode names included).
   * Not covered elsewhere: `apps/studio`'s execute tests use a real SQLite file and mocked
   * drivers for the other engines; nothing runs the packed Studio on a live engine.
   */
  it("studio-execute-select: POST /api/execute returns the rows of a SELECT", async (ctx) => {
    const l = await studioFor(ctx, dialect);
    const reply = await execute(l, `SELECT agency_id, name FROM ${l.scratch.table({ schema: "org", name: "agency" })} ORDER BY agency_id`);

    expectRan(reply);
    expect(reply.json.columns).toEqual(["agency_id", "name"]);
    const expected = [...AGENCIES].sort((a, b) => Number(a.agency_id) - Number(b.agency_id)).map((a) => [String(a.agency_id), a.name]);
    expect((reply.json.rows as unknown[][]).map(([id, name]) => [String(id), name])).toEqual(expected);
  });

  /**
   * Contract: execute validates first: "write or DDL keywords are rejected with `400`"
   * before anything reaches the driver (`studio.mdx`, "Security model"; ADR 0009: execute
   * is "single-statement, read-only").
   * Catches: a packed Studio whose execute passes a write to the driver instead of
   * rejecting it first. Studio holds the owner's credentials here, so only the driver-level
   * guards would remain, which the docs call risk reduction, "not a sandbox".
   * Not covered elsewhere: the safety suite tests `ask()`'s validator, not Studio's use of
   * it; `apps/studio`'s tests use mocked drivers and never show a write would land.
   */
  it("studio-execute-write: a DELETE answers 400 and leaves the rows, though run raw as the owner it empties the table", async (ctx) => {
    const l = await studioFor(ctx, dialect);

    await expectRefusedThoughItWouldLand(l, `DELETE FROM ${l.scratch.table({ schema: "billing", name: "order_line" })}`);
  });

  /**
   * Contract: "Multiple statements … are rejected with `400`" (`studio.mdx`, "Security
   * model"); execute runs one statement.
   * Catches: a packed Studio that lets a second statement through: harmless-looking SELECTs
   * (so only the single-statement check can reject them), and a SELECT followed by a DELETE
   * that, run raw as the owner, lands.
   * Not covered elsewhere: as for `studio-execute-write`.
   */
  it("studio-execute-multi-statement: two SELECTs answer 400, while either alone answers 200", async (ctx) => {
    const l = await studioFor(ctx, dialect);
    const reply = await execute(l, "SELECT 1 AS a; SELECT 2 AS b");

    expect(reply.status, reply.text).toBe(400);
    expect(reply.json).not.toHaveProperty("rows");
    expectRan(await execute(l, "SELECT 1 AS a"));
    expectRan(await execute(l, "SELECT 2 AS b"));
  });

  it("studio-execute-multi-statement: a SELECT then a DELETE answers 400 and leaves the rows, though run raw as the owner it empties the table", async (ctx) => {
    const l = await studioFor(ctx, dialect);

    await expectRefusedThoughItWouldLand(l, `SELECT 1 AS ok; DELETE FROM ${l.scratch.table({ schema: "billing", name: "order_line" })}`);
  });
});
