/**
 * The lab's own Postgres (`compose.yml`): lab-only, so the lab may change it, unlike the shared
 * fixture's databases, which it only reads. It holds the fixture's Postgres schema and rows and
 * adds what the fixture doesn't have: the `lab_tenant` role and row-level security on the tenant
 * tables (`src/lab-postgres.sql`), for the `tenant-rls` scenario (`docs/specs/consumer-lab.md`,
 * "Two things are lab-only and live in the lab, not the fixture").
 *
 * The schema and rows come from the fixture's own seeder, run through its documented interface
 * (`tsx src/seed.ts postgres`, pointed at this server with `ASKDB_FIXTURE_POSTGRES_PORT`, as for
 * a second copy of the fixture), so the lab copies neither its DDL nor its data. The seeder is
 * idempotent by dataset hash; the row-level security is reapplied on every run.
 *
 *   docker compose up -d --wait && tsx src/lab-postgres.ts seed    # `pnpm -C examples/consumer-lab postgres:up`
 *
 * The host port is 15442 unless `ASKDB_LAB_POSTGRES_PORT` overrides it, as in `compose.yml`.
 * The host is the fixture's (`ASKDB_FIXTURE_HOST`), and the credentials are the fixture
 * Postgres's, plus `lab_tenant`.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { connectionUrl } from "./fixture.js";
import { LAB_ROOT } from "./paths.js";

const PORT_ENV = "ASKDB_LAB_POSTGRES_PORT";
const DEFAULT_PORT = 15442;
const FIXTURE_ROOT = fileURLToPath(new URL("../../../fixtures/multi-engine/", import.meta.url));

export function labPostgresPort(): number {
  const override = process.env[PORT_ENV]?.trim();
  if (!override) return DEFAULT_PORT;
  // A bad value must not fall through to the URL's port, which is the shared fixture's.
  const port = /^\d+$/.test(override) ? Number(override) : NaN;
  if (!(port >= 1 && port <= 65535)) throw new Error(`${PORT_ENV} must be a port from 1 to 65535, not ${JSON.stringify(override)}`);
  return port;
}

/**
 * Who connects: `owner` (seeds), `reader` (the fixture's `fixture_reader`, which bypasses row-level
 * security), or `tenant` (`lab_tenant`, which the policies keep to `app.agency_id`).
 */
export type LabPostgresRole = "owner" | "reader" | "tenant";

/** The fixture Postgres's URL for the role, moved to the lab's port. */
export function labPostgresUrl(role: LabPostgresRole): string {
  const url = new URL(connectionUrl("postgres", role === "owner" ? "owner" : "reader"));
  url.port = String(labPostgresPort());
  if (role === "tenant") url.username = url.password = "lab_tenant";
  return url.toString();
}

/**
 * Run one statement on the lab's Postgres the way a host using row-level security does: in a
 * read-only transaction with a statement timeout, and for `tenant`, with the request's agency
 * set for that transaction only (`set_config(…, true)`). Returns the rows as arrays.
 */
export async function labPostgresRows(role: LabPostgresRole, sql: string, opts: { agencyId?: number } = {}): Promise<unknown[][]> {
  const client = new pg.Client({ connectionString: labPostgresUrl(role) });
  try {
    await client.connect();
  } catch (error) {
    throw new Error(
      `can't connect to the lab's Postgres on port ${labPostgresPort()} as ${role} (${(error as Error).message}): start and seed it with \`pnpm lab:up\` or \`pnpm -C examples/consumer-lab postgres:up\``,
      { cause: error },
    );
  }
  try {
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = 5000");
    if (opts.agencyId !== undefined) await client.query("SELECT set_config('app.agency_id', $1, true)", [String(opts.agencyId)]);
    const result = await client.query({ text: sql.trim().replace(/;\s*$/, ""), rowMode: "array" });
    return result.rows as unknown[][];
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    await client.end().catch(() => undefined);
  }
}

/** Run the fixture's seeder against the lab's Postgres. */
function runFixtureSeeder(): void {
  const seeded = spawnSync("pnpm", ["-C", FIXTURE_ROOT, "exec", "tsx", "src/seed.ts", "postgres"], {
    stdio: "inherit",
    env: { ...process.env, ASKDB_FIXTURE_POSTGRES_PORT: String(labPostgresPort()) },
  });
  if (seeded.error) throw new Error("lab postgres: couldn't run the fixture's seeder", { cause: seeded.error });
  if (seeded.status !== 0) throw new Error(`lab postgres: the fixture's seeder exited ${seeded.status ?? seeded.signal}`);
}

/**
 * Seed the lab's Postgres with the fixture's seeder, then apply the row-level security in one
 * transaction. The server is shared by every checkout on the machine, like the fixture, so two
 * runs may start at once: both steps run under one session-level advisory lock, which the second
 * run waits for, then finds the dataset up to date. Postgres releases the lock if this process dies.
 */
async function seed(): Promise<void> {
  const client = new pg.Client({ connectionString: labPostgresUrl("owner") });
  await client.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('askdb-lab-postgres-seed'))");
    runFixtureSeeder();
    await client.query("BEGIN");
    await client.query(readFileSync(join(LAB_ROOT, "src", "lab-postgres.sql"), "utf8"));
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const command = process.argv[2];
  if (command !== "seed") {
    console.error("usage: tsx src/lab-postgres.ts seed");
    process.exit(2);
  }
  console.log(`lab postgres (port ${labPostgresPort()}): seeding with the fixture's seeder`);
  await seed();
  console.log("lab postgres: lab_tenant and row-level security applied");
}
