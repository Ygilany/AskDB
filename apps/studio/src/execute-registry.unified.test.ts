import { describe, it, expect, vi, beforeEach } from "vitest";

const captured = {
  pg: { calledWith: undefined as unknown },
  mysql2: { calledWith: undefined as unknown },
  sqlite: { calledWith: undefined as unknown },
  mssql: { calledWith: undefined as unknown },
  mssqlPoolConfig: undefined as unknown,
  isPg: { calledWith: undefined as unknown },
  isMysql2: { calledWith: undefined as unknown },
  isSqlite: { calledWith: undefined as unknown },
  isMssql: { calledWith: undefined as unknown },
  pgClientOpts: undefined as unknown,
  pgQueries: [] as unknown[],
  pgRows: [[1]] as unknown[][],
  mysqlQueries: [] as unknown[],
  mysqlExecute: [] as unknown[],
  mysqlConnectError: undefined as Error | undefined,
  mssqlQueries: [] as string[],
};

vi.mock("@askdb/postgres", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@askdb/postgres")>();
  return {
    ...actual,
    loadPgDriver: vi.fn(async (opts?: { resolveFrom?: string }) => {
      captured.pg.calledWith = opts;
      class Client {
        constructor(opts: unknown) {
          captured.pgClientOpts = opts;
        }
        async connect() {}
        async end() {}
        async query(arg: string | { text: string; values: unknown[] }) {
          captured.pgQueries.push(arg);
          if (typeof arg === "string") return {};
          return {
            fields: [{ name: "n" }],
            rows: captured.pgRows,
          };
        }
      }
      return { Client };
    }),
    isPgDriverInstalled: vi.fn((opts?: { resolveFrom?: string }) => {
      captured.isPg.calledWith = opts;
      return true;
    }),
  };
});

vi.mock("@askdb/mysql", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@askdb/mysql")>();
  return {
    ...actual,
    loadMysql2Driver: vi.fn(async (opts?: { resolveFrom?: string }) => {
      captured.mysql2.calledWith = opts;
      return {
        async createConnection() {
          if (captured.mysqlConnectError) throw captured.mysqlConnectError;
          return {
            async query(sql: string) {
              captured.mysqlQueries.push(sql);
            },
            async execute(opts: unknown) {
              captured.mysqlExecute.push(opts);
              return [[[1]], [{ name: "n" }]];
            },
            async end() {},
          };
        },
      };
    }),
    isMysql2DriverInstalled: vi.fn((opts?: { resolveFrom?: string }) => {
      captured.isMysql2.calledWith = opts;
      return true;
    }),
  };
});

vi.mock("@askdb/sqlite", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@askdb/sqlite")>();
  return {
    ...actual,
    loadBetterSqlite3Driver: vi.fn(async (opts?: { resolveFrom?: string }) => {
      captured.sqlite.calledWith = opts;
      class Database {
        constructor() {}
        prepare() {
          const stmt = {
            reader: true,
            raw: () => stmt,
            columns: () => [{ name: "n" }],
            *iterate() {
              yield [1];
            },
          };
          return stmt;
        }
        close() {}
      }
      return { default: Database };
    }),
    isBetterSqlite3DriverInstalled: vi.fn((opts?: { resolveFrom?: string }) => {
      captured.isSqlite.calledWith = opts;
      return true;
    }),
  };
});

vi.mock("@askdb/sqlserver", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@askdb/sqlserver")>();
  return {
    ...actual,
    loadMssqlDriver: vi.fn(async (opts?: { resolveFrom?: string }) => {
      captured.mssql.calledWith = opts;
      class ConnectionPool {
        constructor(config: unknown) {
          captured.mssqlPoolConfig = config;
        }
        connect() {
          return Promise.resolve(this);
        }
        request() {
          return {
            input() {
              return this;
            },
            async query(sql: string) {
              captured.mssqlQueries.push(sql);
              return { recordset: [] };
            },
          };
        }
        close() {
          return Promise.resolve();
        }
      }
      return { ConnectionPool };
    }),
    isMssqlDriverInstalled: vi.fn((opts?: { resolveFrom?: string }) => {
      captured.isMssql.calledWith = opts;
      return true;
    }),
  };
});

import {
  EXECUTE_DRIVER_REGISTRY,
  executeDialectFor,
  isDriverInstalled,
  isStudioExecuteProvider,
} from "./execute-registry.js";
import { packageManagerSpawnSpec } from "./package-manager.js";

const projectRoot = "/test/project";

describe("execute-registry unified with engine packages", () => {
  beforeEach(() => {
    captured.pg.calledWith = undefined;
    captured.mysql2.calledWith = undefined;
    captured.sqlite.calledWith = undefined;
    captured.mssql.calledWith = undefined;
    captured.mssqlPoolConfig = undefined;
    captured.isPg.calledWith = undefined;
    captured.isMysql2.calledWith = undefined;
    captured.isSqlite.calledWith = undefined;
    captured.isMssql.calledWith = undefined;
    vi.clearAllMocks();
  });

  it.each([
    ["postgres", { connectionString: "postgres://localhost/db" }, () => captured.pg.calledWith],
    ["mysql", { connectionString: "mysql://localhost/db" }, () => captured.mysql2.calledWith],
    ["sqlite", { file: "/tmp/test.db" }, () => captured.sqlite.calledWith],
    ["sqlserver", { connectionString: "Server=localhost;Database=db;" }, () => captured.mssql.calledWith],
  ] as const)("%s execute loads its driver with resolveFrom: projectRoot", async (provider, connection, loadedWith) => {
    await EXECUTE_DRIVER_REGISTRY[provider].execute({ ...connection, sql: "SELECT 1", params: [], projectRoot });
    expect(loadedWith()).toEqual({ resolveFrom: projectRoot });
  });

  it.each([
    ["pg", () => captured.isPg.calledWith],
    ["mysql2", () => captured.isMysql2.calledWith],
    ["better-sqlite3", () => captured.isSqlite.calledWith],
    ["mssql", () => captured.isMssql.calledWith],
  ] as const)("isDriverInstalled(%s) checks with resolveFrom: projectRoot", (packageName, checkedWith) => {
    isDriverInstalled(packageName, projectRoot);
    expect(checkedWith()).toEqual({ resolveFrom: projectRoot });
  });
});

describe("studio sqlserver execute applies resolveConnectionInput", () => {
  beforeEach(() => {
    captured.mssqlPoolConfig = undefined;
    vi.clearAllMocks();
  });

  it("converts mssql:// URL to a config object", async () => {
    const cs = "mssql://appuser:Str0ngP4ss@db.example.com:1433/AppCatalog?trustServerCertificate=true";
    await EXECUTE_DRIVER_REGISTRY.sqlserver.execute({
      connectionString: cs,
      sql: "SELECT 1",
      params: [],
      projectRoot,
    });
    expect(captured.mssqlPoolConfig).toEqual({
      server: "db.example.com",
      port: 1433,
      database: "AppCatalog",
      user: "appuser",
      password: "Str0ngP4ss",
      options: { trustServerCertificate: true },
    });
  });
});

describe("studio execute safety", () => {
  beforeEach(() => {
    captured.pgClientOpts = undefined;
    captured.pgQueries = [];
    captured.pgRows = [[1]];
    captured.mysqlQueries = [];
    captured.mysqlExecute = [];
    captured.mysqlConnectError = undefined;
    captured.mssqlQueries = [];
    vi.clearAllMocks();
  });

  it("postgres runs one statement via the extended protocol inside a read-only transaction", async () => {
    const result = await EXECUTE_DRIVER_REGISTRY.postgres.execute({
      connectionString: "postgres://localhost/db",
      sql: "SELECT 1",
      params: [],
      projectRoot,
    });
    expect(result.ok).toBe(true);
    const strings = captured.pgQueries.filter((q): q is string => typeof q === "string");
    expect(strings).toEqual([
      "SET default_transaction_read_only = on",
      "BEGIN READ ONLY",
      "SET LOCAL statement_timeout = 30000",
      "ROLLBACK",
    ]);
    const configs = captured.pgQueries.filter((q) => typeof q === "object") as Array<Record<string, unknown>>;
    expect(configs).toHaveLength(1);
    // Empty params would otherwise use the simple protocol, which runs `SELECT 1; COMMIT; DROP ...`.
    expect(configs[0]).toMatchObject({ queryMode: "extended", rowMode: "array", values: [] });
    expect(configs[0]!.name).toEqual(expect.any(String));
    expect(configs[0]!.text).toBe("SELECT * FROM (\nSELECT 1\n) AS askdb_q LIMIT 501");
    expect(captured.pgClientOpts).toMatchObject({ query_timeout: expect.any(Number) });
  });

  it("postgres honors timeoutMs / maxRows and reports truncation", async () => {
    captured.pgRows = [[1], [2], [3]];
    const result = await EXECUTE_DRIVER_REGISTRY.postgres.execute({
      connectionString: "postgres://localhost/db",
      sql: "SELECT n FROM t",
      params: [],
      projectRoot,
      timeoutMs: 1234,
      maxRows: 2,
    });
    expect(captured.pgQueries).toContain("SET LOCAL statement_timeout = 1234");
    const config = captured.pgQueries.find((q) => typeof q === "object") as { text: string };
    expect(config.text).toMatch(/LIMIT 3$/);
    expect(result).toMatchObject({ ok: true, truncated: true, rowCount: 2, rowLimit: 2, rows: [[1], [2]] });
  });

  it("sqlserver wraps the statement in an always-rolled-back transaction with a row cap", async () => {
    await EXECUTE_DRIVER_REGISTRY.sqlserver.execute({
      connectionString: "Server=localhost;Database=db;",
      sql: "SELECT name FROM sys.tables",
      params: [],
      projectRoot,
      maxRows: 10,
    });
    expect(captured.mssqlQueries).toHaveLength(1);
    const batch = captured.mssqlQueries[0]!;
    const lines = batch.split("\n");
    expect(lines.slice(0, 3)).toEqual(["SET XACT_ABORT ON;", "SET ROWCOUNT 11;", "BEGIN TRANSACTION;"]);
    expect(lines).toContain("SELECT name FROM sys.tables");
    expect(batch.indexOf("BEGIN TRANSACTION")).toBeLessThan(batch.indexOf("SELECT name"));
    expect(batch.indexOf("SELECT name")).toBeLessThan(batch.indexOf("ROLLBACK TRANSACTION"));
    expect(batch).not.toMatch(/COMMIT/i);
  });

  it("mysql uses a read-only transaction, a server-side timeout, and a prepared single statement", async () => {
    await EXECUTE_DRIVER_REGISTRY.mysql.execute({
      connectionString: "mysql://localhost/db",
      sql: "SELECT 1",
      params: [],
      projectRoot,
    });
    expect(captured.mysqlQueries).toEqual([
      "SET SESSION MAX_EXECUTION_TIME = 30000",
      "SET SESSION TRANSACTION READ ONLY",
      "START TRANSACTION READ ONLY",
      "ROLLBACK",
    ]);
    expect(captured.mysqlExecute).toEqual([
      { sql: "SELECT * FROM (\nSELECT 1\n) AS askdb_q LIMIT 501", values: [], rowsAsArray: true },
    ]);
  });

  it("mysql returns ok:false (not a throw) when the connection cannot be opened", async () => {
    captured.mysqlConnectError = new Error("connect ECONNREFUSED 127.0.0.1:3306");
    const result = await EXECUTE_DRIVER_REGISTRY.mysql.execute({
      connectionString: "mysql://localhost/db",
      sql: "SELECT 1",
      params: [],
      projectRoot,
    });
    expect(result).toEqual({ ok: false, error: "connect ECONNREFUSED 127.0.0.1:3306" });
    expect(captured.mysqlQueries).toEqual([]);
  });

  it("executeDialectFor honors a same-family dialect override only", () => {
    expect(executeDialectFor("mysql", "mariadb").id).toBe("mariadb");
    expect(executeDialectFor("postgres", "cockroachdb").id).toBe("cockroachdb");
    expect(executeDialectFor("postgres", "sqlserver").id).toBe("postgres");
    expect(executeDialectFor("sqlite").id).toBe("sqlite");
    expect(executeDialectFor("sqlserver").id).toBe("sqlserver");
  });

  it("isStudioExecuteProvider rejects inherited object keys", () => {
    expect(isStudioExecuteProvider("postgres")).toBe(true);
    for (const key of ["constructor", "__proto__", "toString", "hasOwnProperty", "oracle", 1, null]) {
      expect(isStudioExecuteProvider(key)).toBe(false);
    }
  });
});

describe("packageManagerSpawnSpec", () => {
  it("spawns the bare command without a shell on POSIX", () => {
    expect(packageManagerSpawnSpec("pnpm", ["add", "pg"], "linux")).toEqual({
      command: "pnpm",
      args: ["add", "pg"],
      shell: false,
    });
  });

  it("uses a shell on Windows so .cmd shims can run", () => {
    expect(packageManagerSpawnSpec("npm", ["install", "--save", "@askdb/config@1.0.0-beta.3"], "win32")).toEqual({
      command: "npm",
      args: ["install", "--save", "@askdb/config@1.0.0-beta.3"],
      shell: true,
    });
  });

  it("refuses arguments a shell could interpret", () => {
    for (const bad of ["pg && calc", "pg;rm", "$(x)", "pg|x", "a b", "`x`"]) {
      expect(() => packageManagerSpawnSpec("pnpm", ["add", bad], "win32")).toThrow(/unsafe argument/);
    }
  });
});
