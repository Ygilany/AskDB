import { fileURLToPath } from "node:url";
import { join } from "node:path";

/** Every dialect the lab runs. Names match AskDB's built-in dialect ids. */
export const DIALECTS = ["postgres", "mysql", "mariadb", "sqlserver", "sqlite"] as const;
export type Dialect = (typeof DIALECTS)[number];

/**
 * `owner` seeds the dataset (and, later, the scratch databases the safety suite
 * uses to prove a statement is dangerous). `reader` is the read-only role the
 * host uses to execute generated SQL and to introspect.
 */
export type Role = "owner" | "reader";

export const LAB_ROOT = fileURLToPath(new URL("..", import.meta.url));
export const DATASET_DIR = join(LAB_ROOT, "dataset");
export const SQLITE_FILE = process.env.LAB_SQLITE_FILE ?? join(LAB_ROOT, ".data", "lab.sqlite");

const HOST = process.env.LAB_DB_HOST ?? "127.0.0.1";

const PORTS = { postgres: 15432, mysql: 13306, mariadb: 13307, sqlserver: 11433 } as const;

const CREDENTIALS: Record<Exclude<Dialect, "sqlite">, Record<Role, { user: string; password: string }>> = {
  postgres: { owner: { user: "lab_owner", password: "lab_owner" }, reader: { user: "lab_reader", password: "lab_reader" } },
  mysql: { owner: { user: "root", password: "lab_owner" }, reader: { user: "lab_reader", password: "lab_reader" } },
  mariadb: { owner: { user: "root", password: "lab_owner" }, reader: { user: "lab_reader", password: "lab_reader" } },
  sqlserver: { owner: { user: "sa", password: "Lab.Owner.2026" }, reader: { user: "lab_reader", password: "Lab.Reader.2026" } },
};

/** The default database a connection opens. MySQL/MariaDB hold every logical table in `askdb_lab`. */
const DEFAULT_DATABASE: Record<Exclude<Dialect, "sqlite">, string> = {
  postgres: "askdb_lab",
  mysql: "askdb_lab",
  mariadb: "askdb_lab",
  sqlserver: "askdb_lab",
};

/**
 * Connection string for a dialect and role, in the form each engine's docs (and
 * AskDB's `--url`) accept. SQLite has no URL; use {@link SQLITE_FILE}.
 * Pass `database: null` to connect without selecting a database (server-level work).
 */
export function connectionUrl(dialect: Exclude<Dialect, "sqlite">, role: Role, opts: { database?: string | null } = {}): string {
  const { user, password } = CREDENTIALS[dialect][role];
  const port = PORTS[dialect];
  const database = opts.database === undefined ? DEFAULT_DATABASE[dialect] : opts.database;
  if (dialect === "sqlserver") {
    return [
      `Server=${HOST},${port}`,
      ...(database ? [`Database=${database}`] : []),
      `User Id=${user}`,
      `Password=${password}`,
      "Encrypt=false",
      "TrustServerCertificate=true",
    ].join(";");
  }
  const scheme = dialect === "postgres" ? "postgres" : "mysql";
  const enc = encodeURIComponent;
  return `${scheme}://${enc(user)}:${enc(password)}@${HOST}:${port}/${database ?? ""}`;
}
