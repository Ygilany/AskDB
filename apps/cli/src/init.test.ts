import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { select, input, confirm } from "@inquirer/prompts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  planInitScaffold,
  resolveDefaultInitAnswers,
  resolveInitDepSpecs,
  runInitCli,
  runWizard,
  type InitDepSpecs,
  type InitPrompter,
} from "./init.js";
import { PRISMA_BUILD_APPROVALS } from "./prisma-install.js";

// Only buildInquirerPrompter imports this; the runWizard tests pass their own prompter.
vi.mock("@inquirer/prompts", () => ({
  select: vi.fn().mockRejectedValue(new Error("unexpected prompt")),
  input: vi.fn().mockRejectedValue(new Error("unexpected prompt")),
  confirm: vi.fn().mockRejectedValue(new Error("unexpected prompt")),
}));

const FAKE_SPECS: InitDepSpecs = { configSpec: "1.0.0", prismaSpec: "0.2.0" };

/** Make stdin and stdout look like a terminal; returns the function that puts them back. */
function fakeTty(): () => void {
  const stdinTTY = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
  const stdoutTTY = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
  Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
  Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
  return () => {
    if (stdinTTY) Object.defineProperty(process.stdin, "isTTY", stdinTTY);
    else delete (process.stdin as { isTTY?: boolean }).isTTY;
    if (stdoutTTY) Object.defineProperty(process.stdout, "isTTY", stdoutTTY);
    else delete (process.stdout as { isTTY?: boolean }).isTTY;
  };
}

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

  it("scaffolds gateway with the env vars from @askdb/ai's provider table", () => {
    const a = resolveDefaultInitAnswers({ aiProvider: "gateway" });
    expect(a.aiKeyEnv).toBe("AI_GATEWAY_API_KEY");
    expect(a.aiModelEnv).toBe("ASKDB_AI_MODEL");
    const out = planInitScaffold(a, FAKE_SPECS).configSource;
    expect(out).toContain('provider: "gateway"');
    expect(out).toContain('apiKey: env("AI_GATEWAY_API_KEY")');
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

describe("runWizard", () => {
  it("never asks the user to name an env var — uses conventional defaults", async () => {
    const { prompter, messages } = createRecordingPrompter();
    const answers = await runWizard(prompter);
    expect(answers.connectionEnv).toBe("DATABASE_URL");
    expect(answers.aiKeyEnv).toBe("OPENAI_API_KEY");
    expect(answers.aiModelEnv).toBe("OPENAI_MODEL");
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
        "Enable Studio execute (run generated SQL read-only from the browser playground)?",
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
    expect(answers.ragStore).toBe("pgvector");
    expect(answers.pgvectorEnv).toBe("PGVECTOR_URL");
    expect(messages.some((m) => m.toLowerCase().includes("env var"))).toBe(false);
  });

  it("defaults Studio execute to off when the user accepts every default", async () => {
    const { prompter } = createRecordingPrompter();
    const answers = await runWizard(prompter);
    expect(answers.studioExecute).toEqual({ enabled: false });
    expect(planInitScaffold(answers, FAKE_SPECS).configSource).not.toContain("studio:");
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
    expect(answers.database).toBe("prisma");
    expect(answers.studioExecute).toEqual({ enabled: true, provider: "postgres", connectionEnv: "DATABASE_URL" });
    expect(messages).toContain("Studio execute needs a live database provider. Which one?");
  });
});

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
    expect(writes.join("")).toContain("Unknown option: --nonexistent-flag");
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
      expect(content).toContain('databaseUrl: env("DATABASE_URL")');
      expect(content).not.toContain("studio:");
      expect(noopInstaller).not.toHaveBeenCalled();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it.each(["--no-interactive", "--yes"])("%s never prompts, even in a TTY", async (flag) => {
    const tmp = mkdtempSync(join(tmpdir(), "askdb-init-test-"));
    const restoreTty = fakeTty();
    try {
      const outPath = join(tmp, "askdb.config.ts");
      const code = await runInitCli([flag, "--skip-install", "--path", outPath]);
      expect(code).toBe(0);
      const content = readFileSync(outPath, "utf8");
      expect(content).toContain('provider: "postgres"');
      expect(select).not.toHaveBeenCalled();
      expect(input).not.toHaveBeenCalled();
      expect(confirm).not.toHaveBeenCalled();
    } finally {
      restoreTty();
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
      expect(content).toContain('databaseUrl: env("DATABASE_URL")');
      expect(content).not.toContain('"postgres"');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it.each([
    { flags: [], envName: "SQLITE_FILE" },
    { flags: ["--sqlite-file", "MY_SQLITE_FILE"], envName: "MY_SQLITE_FILE" },
    { flags: ["--sqlite-file", "MY_SQLITE_FILE", "--studio-execute"], envName: "MY_SQLITE_FILE" },
  ])("--database sqlite $flags: .env.example lists the file env var the config reads", async ({ flags, envName }) => {
    const tmp = mkdtempSync(join(tmpdir(), "askdb-init-test-"));
    try {
      const outPath = join(tmp, "askdb.config.ts");
      const code = await runInitCli([
        "--yes", "--skip-install", "--path", outPath, "--database", "sqlite", ...flags,
      ]);
      expect(code).toBe(0);
      expect(readFileSync(outPath, "utf8")).toContain(`file: env("${envName}")`);
      const envExample = readFileSync(join(tmp, ".env.example"), "utf8");
      expect(envExample).toMatch(new RegExp(`^${envName}=`, "m"));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it.each(["./data.db", "/srv/data.db", "data.db", "db/app.db", "../db/app.db"])(
    "--database sqlite --sqlite-file %s: a path is written literally and adds no env var",
    async (file) => {
    const tmp = mkdtempSync(join(tmpdir(), "askdb-init-test-"));
    try {
      const outPath = join(tmp, "askdb.config.ts");
      const code = await runInitCli([
        "--yes", "--skip-install", "--path", outPath, "--database", "sqlite", "--sqlite-file", file,
      ]);
      expect(code).toBe(0);
      expect(readFileSync(outPath, "utf8")).toContain(`file: ${JSON.stringify(file)}`);
      const envExample = readFileSync(join(tmp, ".env.example"), "utf8");
      expect(envExample).not.toContain(file);
      expect(envExample).not.toMatch(/SQLITE/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
    },
  );

  it.each([
    { flags: ["--database", "prisma", "--studio-execute"], envName: "DATABASE_URL" },
    { flags: ["--rag-store", "pgvector"], envName: "PGVECTOR_URL" },
  ])("$flags: .env.example lists $envName, which the config reads, once", async ({ flags, envName }) => {
    const tmp = mkdtempSync(join(tmpdir(), "askdb-init-test-"));
    try {
      const outPath = join(tmp, "askdb.config.ts");
      const code = await runInitCli(["--yes", "--skip-install", "--path", outPath, ...flags]);
      expect(code).toBe(0);
      expect(readFileSync(outPath, "utf8")).toContain(`env("${envName}")`);
      const envExample = readFileSync(join(tmp, ".env.example"), "utf8");
      expect(envExample.match(new RegExp(`^${envName}=`, "gm"))).toHaveLength(1);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  // #777: Studio execute on the introspection engine reads the same connection env var, as the wizard does.
  it.each(["postgres", "mysql", "sqlserver"])(
    "--database %s --connection-env PG_URL --studio-execute: introspection and execute both read PG_URL",
    async (database) => {
      const tmp = mkdtempSync(join(tmpdir(), "askdb-init-test-"));
      try {
        const outPath = join(tmp, "askdb.config.ts");
        const code = await runInitCli([
          "--yes", "--skip-install", "--path", outPath,
          "--database", database, "--connection-env", "PG_URL", "--studio-execute",
        ]);
        expect(code).toBe(0);
        const config = readFileSync(outPath, "utf8");
        expect(config.match(/databaseUrl: env\("PG_URL"\)/g)).toHaveLength(2);
        expect(config).not.toContain("DATABASE_URL");
        const envExample = readFileSync(join(tmp, ".env.example"), "utf8");
        expect(envExample).not.toContain("DATABASE_URL");
        expect(envExample.match(/^PG_URL=/gm)).toHaveLength(1);
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    },
  );

  it("Studio execute on another engine than introspection keeps DATABASE_URL, and an explicit execute env var wins", () => {
    const other = resolveDefaultInitAnswers({ database: "mysql", connectionEnv: "MY_URL", studioExecute: true, studioExecuteProvider: "postgres" });
    expect(other.studioExecute).toMatchObject({ enabled: true, provider: "postgres", connectionEnv: "DATABASE_URL" });
    const explicit = resolveDefaultInitAnswers({ database: "mysql", connectionEnv: "MY_URL", studioExecute: true, studioExecuteConnectionEnv: "EXEC_URL" });
    expect(explicit.studioExecute).toMatchObject({ enabled: true, provider: "mysql", connectionEnv: "EXEC_URL" });
  });

  it("--ai-provider azure: config and .env.example include the resource name", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "askdb-init-test-"));
    try {
      const outPath = join(tmp, "askdb.config.ts");
      const code = await runInitCli([
        "--yes", "--skip-install", "--path", outPath, "--ai-provider", "azure",
      ]);
      expect(code).toBe(0);
      const content = readFileSync(outPath, "utf8");
      expect(content).toContain('provider: "azure"');
      expect(content).toContain('resourceName: env("AZURE_RESOURCE_NAME")');
      const envExample = readFileSync(join(tmp, ".env.example"), "utf8");
      expect(envExample).toMatch(/^AZURE_OPENAI_API_KEY=$/m);
      expect(envExample).toMatch(/^AZURE_RESOURCE_NAME=$/m);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  // The flag's value would land in the config as `env("my-url")`, which no shell can set.
  it.each([
    [["--connection-env", "my-url"], "--connection-env must be an environment variable name"],
    [["--ai-key-env", "sk-live-1234"], "--ai-key-env must be an environment variable name"],
    [["--rag-store", "pgvector", "--pgvector-env", "pgvector url"], "--pgvector-env must be an environment variable name"],
    [["--database", "sqlite", "--sqlite-file", "./shop\n.db"], "--sqlite-file must not contain control characters"],
  ])("%j fails, naming the flag, and writes nothing", async (flags, message) => {
    const tmp = mkdtempSync(join(tmpdir(), "askdb-init-test-"));
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    try {
      const code = await runInitCli(["--yes", "--skip-install", "--path", join(tmp, "askdb.config.ts"), ...flags]);
      expect(code).toBe(1);
      expect(stderr.mock.calls.join("")).toContain(message);
      expect(readdirSync(tmp)).toEqual([]);
    } finally {
      stderr.mockRestore();
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
      // Execute is opt-in at runtime — choosing it must write `enabled: true`.
      expect(content).toContain("enabled: true");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// #988: in a terminal without --yes, a flag answers its wizard question instead of being dropped.
describe("runInitCli wizard in a TTY", () => {
  let tmp: string;
  let asked: string[];
  /** The choice to pick for a select prompt, by message; any other prompt takes its default. */
  let picks: Record<string, string>;
  let restoreTty: () => void;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "askdb-init-wizard-"));
    asked = [];
    picks = {};
    restoreTty = fakeTty();
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
    // Every prompt is answered with its default, like pressing Enter, unless `picks` names a choice.
    vi.mocked(select).mockImplementation((async (opts: { message: string; default?: unknown; choices: Array<{ value: unknown }> }) => {
      asked.push(opts.message);
      return picks[opts.message] ?? opts.default ?? opts.choices[0]!.value;
    }) as unknown as typeof select);
    vi.mocked(input).mockImplementation((async (opts: { message: string; default?: string }) => {
      asked.push(opts.message);
      return opts.default ?? "";
    }) as unknown as typeof input);
    vi.mocked(confirm).mockImplementation((async (opts: { message: string; default?: boolean }) => {
      asked.push(opts.message);
      return opts.default ?? true;
    }) as unknown as typeof confirm);
  });

  afterEach(() => {
    for (const prompt of [select, input, confirm]) vi.mocked(prompt).mockReset().mockRejectedValue(new Error("unexpected prompt"));
    vi.mocked(process.stdout.write).mockRestore();
    restoreTty();
    rmSync(tmp, { recursive: true, force: true });
  });

  async function initInTty(flags: string[]): Promise<string> {
    const outPath = join(tmp, "askdb.config.ts");
    expect(await runInitCli(["--skip-install", "--path", outPath, ...flags])).toBe(0);
    return readFileSync(outPath, "utf8");
  }

  it("with no answer flags, asks every question", async () => {
    const config = await initInTty([]);
    expect(config).toContain('provider: "postgres"');
    expect(asked).toEqual([
      "Database source",
      "Schema output directory",
      "AI provider",
      "RAG store",
      "Enable Studio execute (run generated SQL read-only from the browser playground)?",
      "Write config and install packages?",
    ]);
  });

  it.each([
    {
      flags: ["--database", "mysql"],
      config: ['provider: "mysql"', 'databaseUrl: env("DATABASE_URL")'],
      skipped: ["Database source"],
    },
    {
      flags: ["--database", "sqlite", "--sqlite-file", "./shop.db"],
      config: ['provider: "sqlite"', 'file: "./shop.db"'],
      skipped: ["Database source", "SQLite file path"],
    },
    {
      flags: ["--database", "sqlserver", "--connection-env", "MSSQL_URL", "--schema-out", "./schema"],
      config: ['provider: "sqlserver"', 'databaseUrl: env("MSSQL_URL")', '"./schema"'],
      skipped: ["Database source", "Schema output directory"],
    },
    {
      flags: ["--database", "prisma", "--prisma-schema", "./db/schema.prisma", "--no-studio-execute"],
      config: ['"./db/schema.prisma"'],
      skipped: [
        "Database source",
        "Path to schema.prisma",
        "Enable Studio execute (run generated SQL read-only from the browser playground)?",
      ],
    },
    {
      // Prisma has no live database, so the wizard asks which one execute uses; --sqlite-file names its file.
      flags: ["--database", "prisma", "--studio-execute", "--sqlite-file", "./exec.db"],
      picks: { "Studio execute needs a live database provider. Which one?": "sqlite" },
      config: ['file: "./exec.db"', "enabled: true"],
      skipped: ["SQLite file path for Studio execute"],
    },
    {
      flags: ["--ai-provider", "anthropic", "--ai-key-env", "CLAUDE_KEY", "--ai-model-env", "CLAUDE_MODEL"],
      config: ['provider: "anthropic"', 'apiKey: env("CLAUDE_KEY")', 'model: env("CLAUDE_MODEL")'],
      skipped: ["AI provider"],
    },
    {
      flags: ["--rag-store", "pgvector", "--pgvector-env", "VEC_URL", "--studio-execute"],
      config: ['env("VEC_URL")', "enabled: true"],
      skipped: ["RAG store", "Enable Studio execute (run generated SQL read-only from the browser playground)?"],
    },
  ] as Array<{ flags: string[]; picks?: Record<string, string>; config: string[]; skipped: string[] }>)(
    "$flags answer their questions, and the wizard skips them", async ({ flags, picks: rowPicks, config, skipped }) => {
    picks = rowPicks ?? {};
    const written = await initInTty(flags);
    for (const text of config) expect(written).toContain(text);
    for (const message of skipped) expect(asked).not.toContain(message);
    expect(asked).toContain("Write config and install packages?");
  });
});

describe("init helpers", () => {
  it("resolveInitDepSpecs returns non-empty specs", () => {
    const s = resolveInitDepSpecs();
    expect(s.configSpec.length).toBeGreaterThan(0);
  });

  // The introspect command's missing-package hint keeps its own copy of the approvals.
  it("approves the same Prisma build in the introspect hint as the scaffold planner does", () => {
    const plan = planInitScaffold(resolveDefaultInitAnswers({ database: "prisma" }), FAKE_SPECS);
    expect(PRISMA_BUILD_APPROVALS).toEqual(plan.install.allowBuilds);
  });

  it("resolveInitDepSpecs pins @askdb/prisma to the version this CLI was built with", () => {
    const prismaPkg = JSON.parse(readFileSync(join(import.meta.dirname, "../../../packages/prisma/package.json"), "utf8"));
    expect(resolveInitDepSpecs().prismaSpec).toBe(prismaPkg.version);
  });
});

describe("runInitCli install", () => {
  const prevCwd = process.cwd();
  const prevPath = process.env.PATH;
  let project: string;
  let stdout: string[];
  let stderr: string[];

  /**
   * cd into a fresh project holding `files` (none: no package.json at all), with a fake
   * `pnpm` on PATH that reports `pnpmVersion`. `npm_config_user_agent` is cleared unless
   * `userAgent` is given, so the test runner's own pnpm doesn't pick the manager.
   */
  function enterProject(files: Record<string, string>, { pnpmVersion = "11.28.10", userAgent = "" } = {}): void {
    project = realpathSync(mkdtempSync(join(tmpdir(), "askdb-init-install-")));
    for (const [name, contents] of Object.entries(files)) writeFileSync(join(project, name), contents, "utf8");
    const bin = join(project, ".fake-bin");
    mkdirSync(bin);
    writeFileSync(join(bin, "pnpm"), `#!/bin/sh\necho ${pnpmVersion}\n`, "utf8");
    chmodSync(join(bin, "pnpm"), 0o755);
    process.env.PATH = `${bin}${delimiter}${prevPath}`;
    vi.stubEnv("npm_config_user_agent", userAgent);
    process.chdir(project);
  }

  beforeEach(() => {
    stdout = [];
    stderr = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => (stdout.push(String(chunk)), true));
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => (stderr.push(String(chunk)), true));
  });

  afterEach(() => {
    process.env.PATH = prevPath;
    process.chdir(prevCwd);
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    rmSync(project, { recursive: true, force: true });
  });

  /** What a Prisma project installs: `ai` (the newest major `@askdb/core` accepts) and `zod` too, for Yarn Plug'n'Play (#760). */
  function prismaPackages(): string[] {
    const { prismaSpec, configSpec } = resolveInitDepSpecs();
    return [`@askdb/config@${configSpec}`, `@askdb/prisma@${prismaSpec}`, "ai@^7.0.51", "zod@^4.6.7"];
  }

  // `pnpm add --allow-build` arrived in pnpm 10.4.0; older pnpm rejects the unknown option.
  it.each([
    ["11.28.10", ["@prisma/engines"]],
    ["10.4.0", ["@prisma/engines"]],
    ["10.3.0", []],
    ["9.15.9", []],
  ])("in a pnpm %s project, the install it runs and the fallback command approve %j", async (pnpmVersion, allowBuilds) => {
    enterProject(
      { "package.json": '{ "name": "app", "private": true }\n', "pnpm-lock.yaml": "lockfileVersion: '9.0'\n" },
      { pnpmVersion },
    );
    const failingInstaller = vi.fn().mockReturnValue(false);

    const code = await runInitCli(["--yes", "--database", "prisma", "--path", join(project, "askdb.config.ts")], failingInstaller);

    expect(code).toBe(1);
    expect(failingInstaller).toHaveBeenCalledWith("pnpm", project, prismaPackages(), allowBuilds);
    const command = ["pnpm add", ...allowBuilds.map((name) => `--allow-build=${name}`), ...prismaPackages()].join(" ");
    expect(stderr.join("")).toContain(`  ${command}\n`);
  });

  // A project that already lists `ai` or `zod` keeps its range: `init` doesn't move `ai@^6` to 7.
  it("installs ai and zod for a Prisma project only when its package.json doesn't list them", async () => {
    enterProject({
      "package.json": JSON.stringify({ name: "app", private: true, dependencies: { ai: "^6.0.0" }, devDependencies: { zod: "^3.25.76" } }),
      "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
    });
    const installer = vi.fn().mockReturnValue(true);

    const code = await runInitCli(["--yes", "--database", "prisma", "--path", join(project, "askdb.config.ts")], installer);

    expect(code).toBe(0);
    const { configSpec, prismaSpec } = resolveInitDepSpecs();
    expect(installer).toHaveBeenCalledWith("pnpm", project, [`@askdb/config@${configSpec}`, `@askdb/prisma@${prismaSpec}`], ["@prisma/engines"]);
  });

  // #750: `pnpm init` writes devEngines.packageManager and no lockfile, and npm refuses to
  // install there (EBADDEVENGINES), so the install and its recovery command must use pnpm.
  it("in a fresh `pnpm init` project with no lockfile, installs with pnpm", async () => {
    const manifest = { name: "proj", devEngines: { packageManager: { name: "pnpm", version: "12.18.0", onFail: "download" } } };
    enterProject({ "package.json": JSON.stringify(manifest) });
    const failingInstaller = vi.fn().mockReturnValue(false);

    await runInitCli(["--yes", "--database", "sqlite", "--sqlite-file", "./shop.db", "--path", join(project, "askdb.config.ts")], failingInstaller);

    const packages = [`@askdb/config@${resolveInitDepSpecs().configSpec}`, "better-sqlite3"];
    expect(failingInstaller).toHaveBeenCalledWith("pnpm", project, packages, ["better-sqlite3"]);
    expect(stderr.join("")).toContain(`  pnpm add --allow-build=better-sqlite3 ${packages.join(" ")}\n`);
  });

  // #937: a local install puts no bare `askdb` on PATH, so each command the Next steps print
  // runs the CLI through the project's package manager, and the copy step is a command too.
  /** Run `init --yes` for SQLite in the current project, with `os` as the platform; returns its stdout. */
  async function initNextSteps(os = "linux", extraArgs: string[] = []): Promise<string> {
    const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
    Object.defineProperty(process, "platform", { ...platform, value: os });
    try {
      const code = await runInitCli(
        ["--yes", "--database", "sqlite", "--sqlite-file", "./shop.db", "--path", join(project, "askdb.config.ts"), ...extraArgs],
        vi.fn().mockReturnValue(true),
      );
      expect(code).toBe(0);
    } finally {
      Object.defineProperty(process, "platform", platform);
    }
    return stdout.join("");
  }

  const WITH_ASKDB = '{ "name": "app", "private": true, "devDependencies": { "askdb": "1.0.0" } }\n';

  it.each([
    ["package-lock.json", "linux", "cp", "npx askdb"],
    ["pnpm-lock.yaml", "linux", "cp", "pnpm exec askdb"],
    ["yarn.lock", "linux", "cp", "yarn askdb"],
    ["bun.lock", "linux", "cp", "bunx askdb"],
    ["package-lock.json", "win32", "copy", "npx askdb"],
  ])("in a project that lists askdb, with %s on %s, the Next steps copy with `%s` and run `%s`", async (lockfile, os, copy, askdb) => {
    enterProject({ "package.json": WITH_ASKDB, [lockfile]: "" });

    expect(await initNextSteps(os)).toContain(
      [
        "\nNext steps:",
        `  1. Create .env from the example, then fill in your credentials:  ${copy} .env.example .env`,
        "     (Rename any `env(\"...\")` call in askdb.config.ts if you prefer different variable names.)",
        `  2. Introspect your database:  ${askdb} introspect`,
        `  3. Ask a question:  ${askdb} ask --question "Which customers signed up last week?"`,
        "",
      ].join("\n"),
    );
  });

  // After `pnpm dlx askdb init`, askdb isn't a dependency, so `pnpm exec askdb` would fail.
  it.each([
    ["package-lock.json", "npx askdb"],
    ["pnpm-lock.yaml", "pnpm dlx askdb"],
    ["yarn.lock", "yarn dlx askdb"],
    ["bun.lock", "bunx askdb"],
  ])("in a project that doesn't list askdb, with %s, the Next steps run `%s`", async (lockfile, askdb) => {
    enterProject({ "package.json": '{ "name": "app", "private": true }\n', [lockfile]: "" });

    expect(await initNextSteps()).toContain(`  2. Introspect your database:  ${askdb} introspect\n`);
  });

  // A copy over an existing .env would replace the app's real secrets with the blank template.
  it("when .env already exists, step 1 says to add the variables instead of printing a copy command", async () => {
    enterProject({ "package.json": WITH_ASKDB, "package-lock.json": "", ".env": "DATABASE_URL=postgres://real\n" });

    const out = await initNextSteps();

    expect(out).toContain("  1. Add the variables in .env.example to your .env, then fill in your credentials.\n");
    expect(out).not.toContain("cp .env.example");
    expect(readFileSync(join(project, ".env"), "utf8")).toBe("DATABASE_URL=postgres://real\n");
  });

  it("with --path in another directory, the copy names the .env.example init wrote there", async () => {
    enterProject({ "package.json": WITH_ASKDB, "package-lock.json": "" });
    mkdirSync(join(project, ".config"));

    const out = await initNextSteps("linux", ["--path", join(project, ".config", "askdb.ts")]);

    expect(out).toContain("then fill in your credentials:  cp .config/.env.example .env\n");
  });

  // #863: pnpm also keeps settings such as minimumReleaseAgeExclude in pnpm-workspace.yaml,
  // so a one-package project can have the file without being a workspace.
  it("in a one-package project whose pnpm-workspace.yaml holds only settings, installs", async () => {
    enterProject({
      "package.json": '{ "name": "app", "private": true }\n',
      "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
      "pnpm-workspace.yaml": "minimumReleaseAgeExclude:\n  - askdb\n  - '@askdb/*'\n",
    });
    const installer = vi.fn().mockReturnValue(true);

    const code = await runInitCli(["--yes", "--database", "sqlite", "--sqlite-file", "./shop.db", "--path", join(project, "askdb.config.ts")], installer);

    expect(code).toBe(0);
    expect(installer).toHaveBeenCalledWith("pnpm", project, [`@askdb/config@${resolveInitDepSpecs().configSpec}`, "better-sqlite3"], ["better-sqlite3"]);
    expect(stdout.join("")).not.toContain("Skipped automatic dependency install");
  });

  // Where init won't install, the command it prints names the detected manager and
  // carries the build approval, so following it works on pnpm 11.
  it.each([
    [
      "at a workspace root",
      { "package.json": '{ "name": "repo", "private": true, "workspaces": ["packages/*"] }\n', "pnpm-lock.yaml": "lockfileVersion: '9.0'\n" },
      "",
    ],
    [
      "at a pnpm workspace root whose pnpm-workspace.yaml lists packages",
      {
        "package.json": '{ "name": "repo", "private": true }\n',
        "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
        "pnpm-workspace.yaml": "packages:\n  - packages/*\nminimumReleaseAgeExclude:\n  - askdb\n",
      },
      "",
    ],
    ["with no package.json, run by `pnpm dlx`", {}, "pnpm/11.28.10 npm/? node/v22.23.4 darwin arm64"],
  ])("%s, prints a pnpm add command with the Prisma build approval", async (_label, files, userAgent) => {
    enterProject(files, { userAgent });
    const installer = vi.fn().mockReturnValue(true);

    const code = await runInitCli(["--yes", "--database", "prisma", "--path", join(project, "askdb.config.ts")], installer);

    expect(code).toBe(0);
    expect(installer).not.toHaveBeenCalled();
    expect(stdout.join("")).toContain(`  pnpm add --allow-build=@prisma/engines ${prismaPackages().join(" ")}\n`);
  });
});
