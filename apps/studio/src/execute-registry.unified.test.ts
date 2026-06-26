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
};

vi.mock("@askdb/postgres", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@askdb/postgres")>();
  return {
    ...actual,
    loadPgDriver: vi.fn(async (opts?: { resolveFrom?: string }) => {
      captured.pg.calledWith = opts;
      class Client {
        constructor() {}
        async connect() {}
        async end() {}
        async query(arg: string | { text: string; values: unknown[] }) {
          if (typeof arg === "string") return {};
          return {
            fields: [{ name: "n" }],
            rows: [{ n: 1 }],
            rowCount: 1,
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
          return {
            async query() {},
            async execute() {
              return [[{ n: 1 }], [{ name: "n" }]];
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
          return {
            columns: () => [{ name: "n" }],
            all: () => [{ n: 1 }],
          };
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
            async query() {
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

import { EXECUTE_DRIVER_REGISTRY, isDriverInstalled } from "./execute-registry.js";

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

  it("postgres execute delegates loadPgDriver with resolveFrom", async () => {
    await EXECUTE_DRIVER_REGISTRY.postgres.execute({
      connectionString: "postgres://localhost/db",
      sql: "SELECT 1",
      params: [],
      projectRoot,
    });
    expect(captured.pg.calledWith).toEqual({ resolveFrom: projectRoot });
  });

  it("mysql execute delegates loadMysql2Driver with resolveFrom", async () => {
    await EXECUTE_DRIVER_REGISTRY.mysql.execute({
      connectionString: "mysql://localhost/db",
      sql: "SELECT 1",
      params: [],
      projectRoot,
    });
    expect(captured.mysql2.calledWith).toEqual({ resolveFrom: projectRoot });
  });

  it("sqlite execute delegates loadBetterSqlite3Driver with resolveFrom", async () => {
    await EXECUTE_DRIVER_REGISTRY.sqlite.execute({
      file: "/tmp/test.db",
      sql: "SELECT 1",
      params: [],
      projectRoot,
    });
    expect(captured.sqlite.calledWith).toEqual({ resolveFrom: projectRoot });
  });

  it("sqlserver execute delegates loadMssqlDriver with resolveFrom", async () => {
    await EXECUTE_DRIVER_REGISTRY.sqlserver.execute({
      connectionString: "Server=localhost;Database=db;",
      sql: "SELECT 1",
      params: [],
      projectRoot,
    });
    expect(captured.mssql.calledWith).toEqual({ resolveFrom: projectRoot });
  });

  it("isDriverInstalled delegates to isPgDriverInstalled", () => {
    isDriverInstalled("pg", projectRoot);
    expect(captured.isPg.calledWith).toEqual({ resolveFrom: projectRoot });
  });

  it("isDriverInstalled delegates to isMysql2DriverInstalled", () => {
    isDriverInstalled("mysql2", projectRoot);
    expect(captured.isMysql2.calledWith).toEqual({ resolveFrom: projectRoot });
  });

  it("isDriverInstalled delegates to isBetterSqlite3DriverInstalled", () => {
    isDriverInstalled("better-sqlite3", projectRoot);
    expect(captured.isSqlite.calledWith).toEqual({ resolveFrom: projectRoot });
  });

  it("isDriverInstalled delegates to isMssqlDriverInstalled", () => {
    isDriverInstalled("mssql", projectRoot);
    expect(captured.isMssql.calledWith).toEqual({ resolveFrom: projectRoot });
  });
});

describe("studio sqlserver execute applies resolveConnectionInput", () => {
  beforeEach(() => {
    captured.mssqlPoolConfig = undefined;
    vi.clearAllMocks();
  });

  it("normalizes spaced ADO.NET TrustServerCertificate key", async () => {
    const cs =
      "Server=db.example.com,1433;Database=AppCatalog;User Id=appuser;Password=Str0ngP4ss;" +
      "Encrypt=True;Trust Server Certificate=True;";
    await EXECUTE_DRIVER_REGISTRY.sqlserver.execute({
      connectionString: cs,
      sql: "SELECT 1",
      params: [],
      projectRoot,
    });
    expect(typeof captured.mssqlPoolConfig).toBe("string");
    expect(captured.mssqlPoolConfig).toContain("TrustServerCertificate=True");
    expect(captured.mssqlPoolConfig as string).not.toMatch(/Trust\s+Server\s+Certificate/i);
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

  it("passes through plain ADO.NET strings with no affected keys", async () => {
    const cs = "Server=db.example.com,1433;Database=AppCatalog;User Id=appuser;Password=Str0ngP4ss;";
    await EXECUTE_DRIVER_REGISTRY.sqlserver.execute({
      connectionString: cs,
      sql: "SELECT 1",
      params: [],
      projectRoot,
    });
    expect(captured.mssqlPoolConfig).toBe(cs);
  });
});
