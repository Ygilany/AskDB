import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  buildInitInstallPlan,
  detectPackageManager,
  findNearestPackageJsonDir,
  isLikelyWorkspaceRoot,
  renderInitConfig,
  resolveDefaultInitAnswers,
  resolveInitDepSpecs,
  runInitCli,
  runWizard,
  type InitAnswers,
  type InitDepSpecs,
  type InitPrompter,
} from "./init.js";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function postgresAnswers(overrides: Partial<InitAnswers> = {}): InitAnswers {
  return {
    database: "postgres",
    connectionEnv: "DATABASE_URL",
    schemaOut: "./askdb",
    aiProvider: "openai",
    aiKeyEnv: "OPENAI_API_KEY",
    aiModelEnv: "OPENAI_MODEL",
    ragStore: "file",
    studioExecute: { enabled: false },
    ...overrides,
  };
}

const FAKE_SPECS: InitDepSpecs = { configSpec: "1.0.0" };

/** A prompter that always accepts the default (like pressing Enter), recording every message asked. */
function createRecordingPrompter(): { prompter: InitPrompter; messages: string[] } {
  const messages: string[] = [];
  const prompter: InitPrompter = {
    async select(opts) {
      messages.push(opts.message);
      return (opts.default ?? opts.choices[0]!.value) as never;
    },
    async input(opts) {
      messages.push(opts.message);
      return opts.default ?? "";
    },
    async confirm(opts) {
      messages.push(opts.message);
      return opts.default ?? true;
    },
  };
  return { prompter, messages };
}

// ---------------------------------------------------------------------------
// renderInitConfig
// ---------------------------------------------------------------------------

describe("renderInitConfig", () => {
  it("Postgres: only postgres branch in introspection", () => {
    const out = renderInitConfig(postgresAnswers());
    expect(out).toContain('provider: "postgres"');
    expect(out).toContain('databaseUrl: env("DATABASE_URL")');
    expect(out).not.toContain("mysql");
    expect(out).not.toContain("sqlserver");
    expect(out).not.toContain("sqlite");
    expect(out).not.toContain("prisma");
    expect(out).not.toContain("studio:");
  });

  it("SQL Server: sqlserver branch + studio.execute.provider when execute enabled", () => {
    const out = renderInitConfig(postgresAnswers({
      database: "sqlserver",
      connectionEnv: "DATABASE_URL",
      studioExecute: { enabled: true, provider: "sqlserver", connectionEnv: "DATABASE_URL" },
    }));
    expect(out).toContain('provider: "sqlserver"');
    expect(out).toContain('databaseUrl: env("DATABASE_URL")');
    expect(out).toContain("studio:");
    expect(out).not.toContain('"postgres"');
    expect(out).not.toContain('"pg"');
  });

  it("SQLite: file field in introspection and studio.execute", () => {
    const out = renderInitConfig(postgresAnswers({
      database: "sqlite",
      sqliteFile: "SQLITE_FILE",
      studioExecute: { enabled: true, provider: "sqlite", sqliteFile: "SQLITE_FILE" },
    }));
    expect(out).toContain('provider: "sqlite"');
    expect(out).toContain('file: env("SQLITE_FILE")');
    // studio section also uses file
    expect(out).toContain("studio:");
    expect(out).not.toContain("databaseUrl");
  });

  it("Prisma: schemaPath in providerConfig, no live driver branch", () => {
    const out = renderInitConfig(postgresAnswers({
      database: "prisma",
      prismaSchema: "./prisma/schema.prisma",
      studioExecute: { enabled: false },
    }));
    expect(out).toContain('provider: "prisma"');
    expect(out).toContain('schemaPath: "./prisma/schema.prisma"');
    expect(out).not.toContain("studio:");
    expect(out).not.toContain('"postgres"');
  });

  it("Anthropic AI provider: only anthropic branch", () => {
    const out = renderInitConfig(postgresAnswers({
      aiProvider: "anthropic",
      aiKeyEnv: "ANTHROPIC_API_KEY",
      aiModelEnv: "ANTHROPIC_MODEL",
    }));
    expect(out).toContain('provider: "anthropic"');
    expect(out).toContain('apiKey: env("ANTHROPIC_API_KEY")');
    expect(out).not.toContain('"openai"');
  });

  it("pgvector RAG: only pgvector store branch", () => {
    const out = renderInitConfig(postgresAnswers({
      ragStore: "pgvector",
      pgvectorEnv: "ASKDB_PGVECTOR_URL",
    }));
    expect(out).toContain('store: "pgvector"');
    expect(out).toContain('databaseUrl: env("ASKDB_PGVECTOR_URL")');
    expect(out).not.toContain('"file"');
    expect(out).not.toContain('"memory"');
  });

  it("no studio section when studioExecute is disabled", () => {
    const out = renderInitConfig(postgresAnswers({ studioExecute: { enabled: false } }));
    expect(out).not.toContain("studio:");
  });

  it("MySQL: mysql branch only", () => {
    const out = renderInitConfig(postgresAnswers({ database: "mysql", connectionEnv: "DATABASE_URL" }));
    expect(out).toContain('provider: "mysql"');
    expect(out).not.toContain('"postgres"');
  });

  it("no dotenv import: bootstrap handles .env loading", () => {
    const out = renderInitConfig(postgresAnswers());
    expect(out).toContain("satisfies AskDbConfig");
    expect(out).not.toContain("dotenv");
  });
});

// ---------------------------------------------------------------------------
// buildInitInstallPlan
// ---------------------------------------------------------------------------

describe("buildInitInstallPlan", () => {
  it("base packages always included", () => {
    const plan = buildInitInstallPlan(postgresAnswers(), FAKE_SPECS);
    expect(plan.packages).toContain("@askdb/config@1.0.0");
    expect(plan.packages.some((p) => p.startsWith("dotenv"))).toBe(false);
  });

  it("includes pg for postgres", () => {
    const plan = buildInitInstallPlan(postgresAnswers(), FAKE_SPECS);
    expect(plan.packages).toContain("pg");
  });

  it("includes mssql for sqlserver", () => {
    const plan = buildInitInstallPlan(postgresAnswers({ database: "sqlserver", connectionEnv: "DATABASE_URL" }), FAKE_SPECS);
    expect(plan.packages).toContain("mssql");
    expect(plan.packages).not.toContain("pg");
  });

  it("includes better-sqlite3 for sqlite", () => {
    const plan = buildInitInstallPlan(postgresAnswers({ database: "sqlite", sqliteFile: "SQLITE_FILE" }), FAKE_SPECS);
    expect(plan.packages).toContain("better-sqlite3");
    expect(plan.packages).not.toContain("pg");
    expect(plan.packages).not.toContain("mysql2");
  });

  it("prisma without execute: no live driver", () => {
    const plan = buildInitInstallPlan(
      postgresAnswers({ database: "prisma", studioExecute: { enabled: false } }),
      FAKE_SPECS,
    );
    expect(plan.packages).not.toContain("pg");
    expect(plan.packages).not.toContain("mysql2");
    expect(plan.packages).not.toContain("mssql");
    expect(plan.packages).not.toContain("better-sqlite3");
  });

  it("prisma + sqlserver execute: installs mssql", () => {
    const plan = buildInitInstallPlan(
      postgresAnswers({
        database: "prisma",
        studioExecute: { enabled: true, provider: "sqlserver", connectionEnv: "DATABASE_URL" },
      }),
      FAKE_SPECS,
    );
    expect(plan.packages).toContain("mssql");
    expect(plan.packages).not.toContain("pg");
  });

  it("no duplicate packages for same driver", () => {
    const plan = buildInitInstallPlan(
      postgresAnswers({
        database: "postgres",
        studioExecute: { enabled: true, provider: "postgres", connectionEnv: "DATABASE_URL" },
      }),
      FAKE_SPECS,
    );
    const pgCount = plan.packages.filter((p) => p === "pg").length;
    expect(pgCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// resolveDefaultInitAnswers
// ---------------------------------------------------------------------------

describe("resolveDefaultInitAnswers", () => {
  it("non-interactive defaults: postgres/openai/file/no-execute", () => {
    const a = resolveDefaultInitAnswers();
    expect(a.database).toBe("postgres");
    expect(a.aiProvider).toBe("openai");
    expect(a.ragStore).toBe("file");
    expect(a.studioExecute.enabled).toBe(false);
    expect(a.connectionEnv).toBe("DATABASE_URL");
    expect(a.schemaOut).toBe("./askdb");
  });

  it("respects database override", () => {
    const a = resolveDefaultInitAnswers({ database: "sqlserver" });
    expect(a.database).toBe("sqlserver");
    expect(a.connectionEnv).toBe("DATABASE_URL");
  });

  it("respects studioExecute override", () => {
    const a = resolveDefaultInitAnswers({ studioExecute: true });
    expect(a.studioExecute.enabled).toBe(true);
    if (a.studioExecute.enabled) {
      expect(a.studioExecute.provider).toBe("postgres");
    }
  });

  it("sqlserver + studio execute: sqlserver provider", () => {
    const a = resolveDefaultInitAnswers({ database: "sqlserver", studioExecute: true });
    expect(a.studioExecute.enabled).toBe(true);
    if (a.studioExecute.enabled) {
      expect(a.studioExecute.provider).toBe("sqlserver");
    }
  });
});

// ---------------------------------------------------------------------------
// runWizard — env var NAMES are defaulted, never prompted for
// ---------------------------------------------------------------------------

describe("runWizard", () => {
  it("never asks the user to name an env var — uses conventional defaults", async () => {
    const { prompter, messages } = createRecordingPrompter();
    const answers = await runWizard(prompter);
    expect(answers).not.toBeNull();
    expect(answers!.connectionEnv).toBe("DATABASE_URL");
    expect(answers!.aiKeyEnv).toBe("OPENAI_API_KEY");
    expect(answers!.aiModelEnv).toBe("OPENAI_MODEL");
    for (const message of messages) {
      expect(message.toLowerCase()).not.toContain("env var");
    }
  });

  it("still asks for the decisions that have no safe default", async () => {
    const { prompter, messages } = createRecordingPrompter();
    await runWizard(prompter);
    expect(messages).toEqual(
      expect.arrayContaining([
        "Database source",
        "Schema output directory",
        "AI provider",
        "RAG store",
        "Enable Studio execute (run queries from the browser playground)?",
      ]),
    );
  });

  it("pgvector RAG store still defaults its env var without prompting", async () => {
    const { prompter, messages } = createRecordingPrompter();
    prompter.select = (async (opts: Parameters<InitPrompter["select"]>[0]) => {
      messages.push(opts.message);
      if (opts.message === "RAG store") return "pgvector" as never;
      return (opts.default ?? opts.choices[0]!.value) as never;
    }) as InitPrompter["select"];
    const answers = await runWizard(prompter);
    expect(answers!.ragStore).toBe("pgvector");
    expect(answers!.pgvectorEnv).toBe("ASKDB_PGVECTOR_URL");
    expect(messages.some((m) => m.toLowerCase().includes("env var"))).toBe(false);
  });

  it("Prisma + Studio execute still asks which live provider to use (a real decision)", async () => {
    const { prompter, messages } = createRecordingPrompter();
    prompter.select = (async (opts: Parameters<InitPrompter["select"]>[0]) => {
      messages.push(opts.message);
      if (opts.message === "Database source") return "prisma" as never;
      return (opts.default ?? opts.choices[0]!.value) as never;
    }) as InitPrompter["select"];
    prompter.confirm = async (opts) => {
      messages.push(opts.message);
      return true;
    };
    const answers = await runWizard(prompter);
    expect(answers!.database).toBe("prisma");
    expect(answers!.studioExecute).toEqual({ enabled: true, provider: "postgres", connectionEnv: "DATABASE_URL" });
    expect(messages).toContain("Studio execute needs a live database provider. Which one?");
  });
});

// ---------------------------------------------------------------------------
// Option parser (indirectly via runInitCli error paths)
// ---------------------------------------------------------------------------

describe("option parser", () => {
  it("rejects invalid --database value", async () => {
    const writes: string[] = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = (msg: string) => { writes.push(msg); return true; };
    const code = await runInitCli(["--database", "oracle"]);
    process.stderr.write = origWrite;
    expect(code).toBe(1);
    expect(writes.join("")).toContain("oracle");
  });

  it("rejects invalid --ai-provider value", async () => {
    const writes: string[] = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = (msg: string) => { writes.push(msg); return true; };
    const code = await runInitCli(["--ai-provider", "cohere"]);
    process.stderr.write = origWrite;
    expect(code).toBe(1);
    expect(writes.join("")).toContain("cohere");
  });

  it("rejects unknown flags", async () => {
    const writes: string[] = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = (msg: string) => { writes.push(msg); return true; };
    const code = await runInitCli(["--nonexistent-flag"]);
    process.stderr.write = origWrite;
    expect(code).toBe(1);
  });

  it("--yes and --interactive conflict", async () => {
    const writes: string[] = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = (msg: string) => { writes.push(msg); return true; };
    const code = await runInitCli(["--yes", "--interactive"]);
    process.stderr.write = origWrite;
    expect(code).toBe(1);
    expect(writes.join("")).toContain("--yes");
  });
});

// ---------------------------------------------------------------------------
// runInitCli integration
// ---------------------------------------------------------------------------

describe("runInitCli --yes --skip-install", () => {
  it("writes config with default Postgres branch", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "askdb-init-test-"));
    try {
      const outPath = join(tmp, "askdb.config.ts");
      const noopInstaller = vi.fn().mockReturnValue(true);
      const code = await runInitCli(["--yes", "--skip-install", "--path", outPath], noopInstaller);
      expect(code).toBe(0);
      const content = readFileSync(outPath, "utf8");
      expect(content).toContain('provider: "postgres"');
      expect(content).toContain('apiKey: env("OPENAI_API_KEY")');
      expect(content).toContain("satisfies AskDbConfig");
      expect(content).not.toContain('"mysql"');
      expect(content).not.toContain('"sqlserver"');
      expect(noopInstaller).not.toHaveBeenCalled();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("--no-interactive also works without prompts", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "askdb-init-test-"));
    try {
      const outPath = join(tmp, "askdb.config.ts");
      const code = await runInitCli(["--no-interactive", "--skip-install", "--path", outPath]);
      expect(code).toBe(0);
      const content = readFileSync(outPath, "utf8");
      expect(content).toContain('provider: "postgres"');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("respects --database sqlserver flag", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "askdb-init-test-"));
    try {
      const outPath = join(tmp, "askdb.config.ts");
      const code = await runInitCli(["--yes", "--skip-install", "--path", outPath, "--database", "sqlserver"]);
      expect(code).toBe(0);
      const content = readFileSync(outPath, "utf8");
      expect(content).toContain('provider: "sqlserver"');
      expect(content).not.toContain('"postgres"');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("refuses to overwrite without --force", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "askdb-init-test-"));
    try {
      const outPath = join(tmp, "askdb.config.ts");
      writeFileSync(outPath, "// existing\n", "utf8");
      const writes: string[] = [];
      const origWrite = process.stderr.write.bind(process.stderr);
      process.stderr.write = (msg: string) => { writes.push(msg); return true; };
      const code = await runInitCli(["--yes", "--skip-install", "--path", outPath]);
      process.stderr.write = origWrite;
      expect(code).toBe(1);
      expect(writes.join("")).toContain("--force");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("--studio-execute flag generates studio section", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "askdb-init-test-"));
    try {
      const outPath = join(tmp, "askdb.config.ts");
      const code = await runInitCli(["--yes", "--skip-install", "--path", outPath, "--studio-execute"]);
      expect(code).toBe(0);
      const content = readFileSync(outPath, "utf8");
      expect(content).toContain("studio:");
      expect(content).toContain("execute:");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Existing helper tests (preserved)
// ---------------------------------------------------------------------------

describe("init helpers", () => {
  it("findNearestPackageJsonDir finds parent package.json", () => {
    const root = mkdtempSync(join(tmpdir(), "askdb-init-test-"));
    try {
      writeFileSync(join(root, "package.json"), "{}\n", "utf8");
      const nested = join(root, "a", "b");
      mkdirSync(nested, { recursive: true });
      expect(findNearestPackageJsonDir(nested)).toBe(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("findNearestPackageJsonDir returns undefined when missing", () => {
    const root = mkdtempSync(join(tmpdir(), "askdb-init-test-"));
    try {
      expect(findNearestPackageJsonDir(join(root, "x"))).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("isLikelyWorkspaceRoot detects pnpm-workspace.yaml", () => {
    const root = mkdtempSync(join(tmpdir(), "askdb-init-test-"));
    try {
      writeFileSync(join(root, "package.json"), '{"name":"r"}\n', "utf8");
      writeFileSync(join(root, "pnpm-workspace.yaml"), "packages: []\n", "utf8");
      expect(isLikelyWorkspaceRoot(root)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("isLikelyWorkspaceRoot detects npm workspaces field", () => {
    const root = mkdtempSync(join(tmpdir(), "askdb-init-test-"));
    try {
      writeFileSync(join(root, "package.json"), '{"workspaces":["packages/*"]}\n', "utf8");
      expect(isLikelyWorkspaceRoot(root)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("isLikelyWorkspaceRoot is false for a leaf package.json", () => {
    const root = mkdtempSync(join(tmpdir(), "askdb-init-test-"));
    try {
      writeFileSync(join(root, "package.json"), '{"name":"app","private":true}\n', "utf8");
      expect(isLikelyWorkspaceRoot(root)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("detectPackageManager finds lockfile in a parent directory", () => {
    const root = mkdtempSync(join(tmpdir(), "askdb-init-test-"));
    try {
      writeFileSync(join(root, "package.json"), "{}\n", "utf8");
      writeFileSync(join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n", "utf8");
      const pkg = join(root, "packages", "app");
      mkdirSync(pkg, { recursive: true });
      writeFileSync(join(pkg, "package.json"), "{}\n", "utf8");
      expect(detectPackageManager(pkg)).toBe("pnpm");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("resolveInitDepSpecs returns non-empty specs", () => {
    const s = resolveInitDepSpecs();
    expect(s.configSpec.length).toBeGreaterThan(0);
  });
});
