import {
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
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runIntrospectCli } from "./introspect.js";

// These tests install the runtime config in-process; the askdb.config file check is
// covered by the spawned CLI tests.
vi.mock("./project-config.js", () => ({ requireAskDbConfig: vi.fn() }));

const BASE_CONFIG: AskDbConfig = {
  ai: { provider: "openai", providerConfig: { openai: { apiKey: "test-key", model: "gpt-4o-mini" } } },
  introspection: { provider: "postgres", providerConfig: { postgres: {} }, outputDir: "./askdb/" },
  rag: { embedder: "mock", embedderConfig: {}, store: "memory", storeConfig: { memory: {} } },
};

// A third-party engine's block rides in the structured config, which @askdb/config passes
// through untyped (its typed config declares only the built-in engines).
function installRuntime(acme?: { databaseUrl: string }): void {
  const structured = acme
    ? ({
        ...BASE_CONFIG,
        introspection: { ...BASE_CONFIG.introspection, providerConfig: { ...BASE_CONFIG.introspection!.providerConfig, acme } },
      } as AskDbConfig)
    : BASE_CONFIG;
  setAskDbRuntimeForTests(structured);
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
    const structured = request.runtime.structured as
      | { introspection?: { providerConfig?: { acme?: { databaseUrl?: string } } } }
      | undefined;
    const url = request.explicit?.url ?? structured?.introspection?.providerConfig?.acme?.databaseUrl;
    return url
      ? { ok: true as const, connection: { url } }
      : { ok: false as const, error: "Set introspection.providerConfig.acme.databaseUrl or pass --url." };
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
    installRuntime({ databaseUrl: "acme://configured" });
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

  it("forwards --url to the adapter as explicit.url", async () => {
    installRuntime({ databaseUrl: "acme://configured" });
    const { adapter, createConnector, resolveConnection } = acmeAdapter();

    const code = await runIntrospectCli(["--engine", "acme", "--url", "acme://flag", "--print"], {
      connectorRegistry: createConnectorRegistry([adapter]),
    });

    expect(code).toBe(0);
    expect(resolveConnection).toHaveBeenCalledWith(
      expect.objectContaining({ explicit: expect.objectContaining({ url: "acme://flag" }) }),
    );
    expect(createConnector).toHaveBeenCalledWith(expect.objectContaining({ url: "acme://flag" }));
  });

  it("surfaces the adapter's resolution error and exits non-zero", async () => {
    installRuntime();
    const { adapter, createConnector } = acmeAdapter();

    const code = await runIntrospectCli(["--engine", "acme", "--print"], {
      connectorRegistry: createConnectorRegistry([adapter]),
    });

    expect(code).toBe(1);
    expect(stderr).toContain("Set introspection.providerConfig.acme.databaseUrl or pass --url.");
    expect(createConnector).not.toHaveBeenCalled();
  });

  // A lazy entry's package may be absent and costly to import (#339), so the hint names
  // only the engines already loaded rather than importing the others to ask them.
  it("names the loaded engines that provide templates when `introspect templates` targets one that doesn't, loading no other engine", async () => {
    installRuntime();
    const beta: ConnectorProviderAdapter = {
      ...acmeAdapter().adapter,
      provider: "beta",
      getTemplates: () => ({ engine: "beta", version: 1, templates: [] }),
    };
    const gamma = { ...beta, provider: "gamma" };
    const loadGamma = vi.fn(async () => gamma);
    const code = await runIntrospectCli(["templates", "--engine", "acme"], {
      connectorRegistry: createConnectorRegistry([acmeAdapter().adapter, beta, { provider: "gamma", load: loadGamma }]),
    });
    expect(code).toBe(1);
    expect(stderr).toContain(
      "Engine 'acme' does not provide SQL templates yet. 'askdb introspect templates' is currently supported only for --engine beta.",
    );
    expect(loadGamma).not.toHaveBeenCalled();
  });

  // `localhost` resolves to ::1 and 127.0.0.1, so a refused connection rejects with an
  // AggregateError whose own message is empty (#749).
  it("prints each attempt's error when the connection fails with an empty AggregateError", async () => {
    installRuntime();
    const { adapter } = acmeAdapter();
    const refused = new AggregateError(
      [
        Object.assign(new Error("connect ECONNREFUSED ::1:5432"), { code: "ECONNREFUSED" }),
        Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), { code: "ECONNREFUSED" }),
      ],
      "",
    );
    const failing: ConnectorProviderAdapter = {
      ...adapter,
      createConnector: () => ({ mode: "live", input: {}, connector: { describe: async () => Promise.reject(refused) } }),
    };

    const code = await runIntrospectCli(["--engine", "acme", "--url", "acme://u:secret@localhost/db", "--print"], {
      connectorRegistry: createConnectorRegistry([failing]),
    });

    expect(code).toBe(1);
    expect(stderr).toBe("connect ECONNREFUSED ::1:5432\nconnect ECONNREFUSED 127.0.0.1:5432\n");
  });

  it("lists the registered engines when --engine is unknown", async () => {
    installRuntime();
    const code = await runIntrospectCli(["--engine", "nope", "--print"], {
      connectorRegistry: createConnectorRegistry([acmeAdapter().adapter]),
    });
    expect(code).toBe(1);
    expect(stderr).toContain("Unsupported introspection engine 'nope' (expected one of: acme).");
  });

  it("lists the registered engines under --engine in --help", async () => {
    const code = await runIntrospectCli(["--help"], {
      connectorRegistry: createConnectorRegistry([acmeAdapter().adapter]),
    });
    expect(code).toBe(0);
    const engineLine = stdout.split("\n").find((line) => line.trimStart().startsWith("--engine <id>"));
    expect(engineLine).toContain("acme");
    expect(engineLine).not.toContain("mysql");
  });
});

describe("askdb introspect — CLI-owned errors with the built-in registry", () => {
  it("rejects combining --url with --from-export", async () => {
    installRuntime();
    expect(await runIntrospectCli(["--engine", "postgres", "--url", "postgres://h/db", "--from-export", "x", "--print"])).toBe(1);
    expect(stderr).toContain("Use only one input mode: --url or --from-export.");
  });

  it("keeps the `introspect templates` message naming postgres for the built-in registry", async () => {
    installRuntime();
    // `templates` is the first positional, wherever the flags put it.
    expect(await runIntrospectCli(["--engine", "prisma", "templates"])).toBe(1);
    expect(stderr).toContain(
      "Engine 'prisma' does not provide SQL templates yet. 'askdb introspect templates' is currently supported only for --engine postgres.",
    );
  });

  it("keeps the unsupported-engine message listing the built-in engines", async () => {
    installRuntime();
    expect(await runIntrospectCli(["--engine", "oracle", "--print"])).toBe(1);
    expect(stderr).toContain(
      "Unsupported introspection engine 'oracle' (expected one of: postgres, mysql, sqlite, sqlserver, prisma).",
    );
  });
});

// Re-introspecting can drop a column the tenant policy names. `--out` checks the
// policy against the new schema.json and says so, under either enforcement (#332).
describe("askdb introspect --out — tenant policy check", () => {
  const tempDirs: string[] = [];
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  // Under strict the policy no longer loads at all; under warn it loads with warnings.
  it.each([
    { enforcement: "strict", says: "no longer loads" },
    { enforcement: "warn", says: "doesn't match the new schema.json" },
  ] as const)(
    "$enforcement: names the policy's column the new schema.json lacks, and still exits 0",
    async ({ enforcement, says }) => {
      installRuntime();
      const outDir = mkdtempSync(join(tmpdir(), "askdb-introspect-policy-"));
      tempDirs.push(outDir);
      writeFileSync(
        join(outDir, "tenant-policy.md"),
        [
          "---",
          "schemaId: acme",
          `enforcement: ${enforcement}`,
          "roots:",
          "  - id: table:main.widgets",
          "    tenantIdColumn: table:main.widgets#tenant_id",
          "    label: Widget",
          "---",
          "",
        ].join("\n"),
      );

      const code = await runIntrospectCli(
        ["--engine", "acme", "--url", "acme://flag", "--out", outDir],
        { connectorRegistry: createConnectorRegistry([acmeAdapter().adapter]) },
      );

      expect(code).toBe(0);
      expect(existsSync(join(outDir, "schema.json"))).toBe(true);
      expect(stderr).toContain("tenant-policy.md");
      expect(stderr).toContain(says);
      expect(stderr).toContain("table:main.widgets#tenant_id");
    },
  );
});
