import {
  flattenAskDbConfig,
  resetAskDbRuntimeForTests,
  setAskDbRuntimeForTests,
  type AskDbConfig,
} from "@askdb/config";
import {
  createConnectorRegistry,
  type ConnectorConfig,
  type ConnectorConnectionRequest,
  type ConnectorProviderAdapter,
  type IntrospectionResult,
} from "@askdb/introspect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runIntrospectCli } from "./introspect.js";

const BASE_CONFIG: AskDbConfig = {
  ai: { provider: "openai", providerConfig: { openai: { apiKey: "test-key", model: "gpt-4o-mini" } } },
  introspection: { provider: "postgres", providerConfig: { postgres: {} }, outputDir: "./askdb/" },
  rag: { embedder: "mock", embedderConfig: {}, store: "memory", storeConfig: { memory: {} } },
};

function installRuntime(flatExtra: Record<string, string> = {}): void {
  setAskDbRuntimeForTests({ structured: BASE_CONFIG, flat: { ...flattenAskDbConfig(BASE_CONFIG), ...flatExtra } });
}

const acmeResult: IntrospectionResult = {
  schema: {
    schemaId: "acme",
    schemas: [
      {
        name: "main",
        tables: [
          {
            id: "table:main.widgets",
            schema: "main",
            name: "widgets",
            columns: [
              {
                id: "table:main.widgets#id",
                name: "id",
                ordinalPosition: 1,
                dataType: "int",
                udtName: "int",
                nullable: false,
                primaryKey: true,
              },
            ],
            primaryKey: { columns: ["id"] },
            foreignKeys: [],
            uniqueConstraints: [],
            indexes: [],
            checkConstraints: [],
          },
        ],
        views: [],
        enums: [],
        sequences: [],
      },
    ],
  },
  warnings: [],
  isEmpty: false,
  viewDefinitions: {},
  provider: "acme",
};

function acmeAdapter() {
  const createConnector = vi.fn((config: ConnectorConfig) => ({
    mode: "live",
    input: { url: config.url },
    connector: { describe: vi.fn(async () => acmeResult) },
  }));
  const resolveConnection = vi.fn((request: ConnectorConnectionRequest) => {
    const url = request.explicit?.url ?? request.runtime.flat?.["ACME_URL"];
    return url
      ? { ok: true as const, connection: { url }, sourceLabel: url }
      : { ok: false as const, error: "Set ACME_URL or pass --url." };
  });
  const adapter: ConnectorProviderAdapter = { provider: "acme", createConnector, resolveConnection };
  return { adapter, createConnector, resolveConnection };
}

let stdout = "";
let stderr = "";

beforeEach(() => {
  stdout = "";
  stderr = "";
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdout += String(chunk);
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr += String(chunk);
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  resetAskDbRuntimeForTests();
});

describe("askdb introspect — injected connector registry", () => {
  it("dispatches a third-party engine through its adapter's resolveConnection", async () => {
    installRuntime({ ACME_URL: "acme://configured" });
    const { adapter, createConnector, resolveConnection } = acmeAdapter();
    const connectorRegistry = createConnectorRegistry([adapter]);

    const code = await runIntrospectCli(["--engine", "acme", "--print", "--schema-id", "acme"], {
      connectorRegistry,
    });

    expect(stderr).toBe("");
    expect(code).toBe(0);
    expect(resolveConnection).toHaveBeenCalledWith(
      expect.objectContaining({ surface: "cli", explicit: expect.objectContaining({ url: undefined }) }),
    );
    expect(createConnector).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "acme", url: "acme://configured", schemaId: "acme" }),
    );
    expect(stdout).toContain('"id": "table:main.widgets"');
  });

  it("lets explicit --url win over the adapter's configured fallback", async () => {
    installRuntime({ ACME_URL: "acme://configured" });
    const { adapter, createConnector } = acmeAdapter();

    const code = await runIntrospectCli(["--engine", "acme", "--url", "acme://flag", "--print"], {
      connectorRegistry: createConnectorRegistry([adapter]),
    });

    expect(code).toBe(0);
    expect(createConnector).toHaveBeenCalledWith(expect.objectContaining({ url: "acme://flag" }));
  });

  it("surfaces the adapter's resolution error and exits non-zero", async () => {
    installRuntime();
    const { adapter, createConnector } = acmeAdapter();

    const code = await runIntrospectCli(["--engine", "acme", "--print"], {
      connectorRegistry: createConnectorRegistry([adapter]),
    });

    expect(code).toBe(1);
    expect(stderr).toContain("Set ACME_URL or pass --url.");
    expect(createConnector).not.toHaveBeenCalled();
  });

  it("lists the registered engines when --engine is unknown", async () => {
    installRuntime();
    const code = await runIntrospectCli(["--engine", "nope", "--print"], {
      connectorRegistry: createConnectorRegistry([acmeAdapter().adapter]),
    });
    expect(code).toBe(1);
    expect(stderr).toContain("Unsupported introspection engine 'nope' (expected one of: acme).");
  });
});

describe("askdb introspect — built-in engines resolve connections via their adapters", () => {
  it("keeps the Postgres missing-connection message", async () => {
    installRuntime();
    const code = await runIntrospectCli(["--engine", "postgres", "--print"]);
    expect(code).toBe(1);
    expect(stderr).toContain("Provide either --url <postgres-url> or --from-export <bundle-dir>.");
  });

  it("keeps the flag-conflict messages", async () => {
    installRuntime();
    expect(await runIntrospectCli(["--engine", "mysql", "--url", "mysql://h/db", "--from-export", "x", "--print"])).toBe(1);
    expect(stderr).toContain("--from-export is currently supported only for --engine postgres (got mysql).");

    stderr = "";
    expect(await runIntrospectCli(["--engine", "postgres", "--url", "postgres://h/db", "--prisma-schema", "x", "--print"])).toBe(1);
    expect(stderr).toContain("Use --prisma-schema only with --engine prisma.");

    stderr = "";
    expect(await runIntrospectCli(["--engine", "prisma", "--url", "postgres://h/db", "--print"])).toBe(1);
    expect(stderr).toContain("Use --prisma-schema with --engine prisma, not --url or --from-export.");

    stderr = "";
    expect(await runIntrospectCli(["--engine", "postgres", "--url", "postgres://h/db", "--from-export", "x", "--print"])).toBe(1);
    expect(stderr).toContain("Use only one input mode: --url or --from-export.");
  });

  it("keeps the unsupported-engine message listing the built-in engines", async () => {
    installRuntime();
    expect(await runIntrospectCli(["--engine", "oracle", "--print"])).toBe(1);
    expect(stderr).toContain(
      "Unsupported introspection engine 'oracle' (expected one of: postgres, mysql, sqlite, sqlserver, prisma).",
    );
  });
});
