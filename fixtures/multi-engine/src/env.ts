import { fileURLToPath } from "node:url";
import { join } from "node:path";

/** Every engine the fixture runs. Names match AskDB's built-in dialect ids. */
export const DIALECTS = ["postgres", "mysql", "mariadb", "sqlserver", "sqlite"] as const;
export type Dialect = (typeof DIALECTS)[number];

/**
 * `owner` seeds the dataset. `reader` is the read-only role hosts (and tests)
 * use to introspect and to execute generated SQL.
 */
export type Role = "owner" | "reader";

/**
 * Set to the host the fixture runs on (`127.0.0.1` locally, after
 * `pnpm fixture:up`). Integration suites that use the fixture gate on it.
 */
export const FIXTURE_HOST_ENV = "ASKDB_FIXTURE_HOST";

export const FIXTURE_ROOT = fileURLToPath(new URL("..", import.meta.url));
export const DATASET_DIR = join(FIXTURE_ROOT, "dataset");
export const SQLITE_FILE = join(FIXTURE_ROOT, ".data", "multi-engine.sqlite");

/** The logical schemas; real schemas on Postgres/SQL Server, databases on MySQL/MariaDB. */
export const LOGICAL_SCHEMAS = ["org", "people", "billing", "ref"] as const;

function host(): string {
  return process.env[FIXTURE_HOST_ENV]?.trim() || "127.0.0.1";
}

const PORTS = { postgres: 15432, mysql: 13306, mariadb: 13307, sqlserver: 11433 } as const;

const CREDENTIALS: Record<Exclude<Dialect, "sqlite">, Record<Role, { user: string; password: string }>> = {
  postgres: { owner: { user: "fixture_owner", password: "fixture_owner" }, reader: { user: "fixture_reader", password: "fixture_reader" } },
  mysql: { owner: { user: "root", password: "fixture_owner" }, reader: { user: "fixture_reader", password: "fixture_reader" } },
  mariadb: { owner: { user: "root", password: "fixture_owner" }, reader: { user: "fixture_reader", password: "fixture_reader" } },
  sqlserver: { owner: { user: "sa", password: "Fixture.Owner.2026" }, reader: { user: "fixture_reader", password: "Fixture.Reader.2026" } },
};

/** The database a connection opens by default. MySQL/MariaDB default to `org`, one of the four logical databases. */
const DEFAULT_DATABASE: Record<Exclude<Dialect, "sqlite">, string> = {
  postgres: "askdb_fixture",
  mysql: "org",
  mariadb: "org",
  sqlserver: "askdb_fixture",
};

/**
 * Connection string for an engine and role, in the form each engine's docs (and
 * AskDB's `--url`) accept. SQLite has no URL; use {@link SQLITE_FILE}.
 * Pass `database: null` to connect without selecting a database (server-level work).
 */
export function connectionUrl(dialect: Exclude<Dialect, "sqlite">, role: Role, opts: { database?: string | null } = {}): string {
  const { user, password } = CREDENTIALS[dialect][role];
  const port = PORTS[dialect];
  const database = opts.database === undefined ? DEFAULT_DATABASE[dialect] : opts.database;
  if (dialect === "sqlserver") {
    return [
      `Server=${host()},${port}`,
      ...(database ? [`Database=${database}`] : []),
      `User Id=${user}`,
      `Password=${password}`,
      "Encrypt=false",
      "TrustServerCertificate=true",
    ].join(";");
  }
  const scheme = dialect === "postgres" ? "postgres" : "mysql";
  const enc = encodeURIComponent;
  return `${scheme}://${enc(user)}:${enc(password)}@${host()}:${port}/${database ?? ""}`;
}
