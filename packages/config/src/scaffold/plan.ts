/**
 * The scaffold planner: answers about a new project in, the files and installs it needs out.
 * `askdb init` and Studio's setup wizard both call {@link planAskDbScaffold}, so the per-engine
 * facts (config keys, URL formats, driver packages) and the config and `.env.example` layouts
 * live here once. Each front end keeps its own defaults, how it asks, and how files land.
 *
 * @experimental Tooling for `askdb init` and AskDB Studio: a minor release of
 * `@askdb/config` may change these exports (ADR 0030).
 */

import {
  ASKDB_AI_PROVIDERS,
  ASKDB_INTROSPECTION_PROVIDERS,
  ASKDB_RAG_STORES,
  ASKDB_STUDIO_EXECUTE_PROVIDERS,
  type AskDbIntrospectionProvider,
  type AskDbRagStore,
  type AskDbStudioExecuteProvider,
} from "../constants.js";
import { renderAskDbAiConfigScaffold, type AskDbAiConfigScaffoldInput, type AskDbScaffoldEnvVar } from "./ai.js";

/**
 * A setting a config reads either as a literal path or from an env var: `{ path }` is written
 * as a string, `{ env }` as `env("NAME")`.
 *
 * @experimental See the module note.
 */
export type ScaffoldValue = { path: string } | { env: string };

/**
 * What a new project uses. Env var fields take NAMES, never values. Defaults are the
 * caller's: every field the chosen engine, store or execute provider reads must be given.
 *
 * @experimental See the module note.
 */
export type AskDbScaffoldAnswers = {
  database: AskDbIntrospectionProvider;
  /** Env var NAME for the connection URL. Postgres, MySQL and SQL Server. */
  connectionEnv?: string;
  /** The SQLite database file. SQLite only. */
  sqliteFile?: ScaffoldValue;
  /** Path to `schema.prisma`. Prisma only; omit to let `@askdb/prisma` find it. */
  prismaSchemaPath?: string;
  /** Schema artifact directory (`introspection.outputDir`). */
  schemaOut: string;
  ai: AskDbAiConfigScaffoldInput;
  /** `pgvectorEnv` names the connection URL's env var, for the pgvector store. */
  rag: { store: AskDbRagStore; pgvectorEnv?: string };
  /** Turns on Studio execute against this live database. `connectionEnv` for a URL engine, `sqliteFile` for SQLite. */
  studioExecute?: { provider: AskDbStudioExecuteProvider; connectionEnv?: string; sqliteFile?: ScaffoldValue };
};

/**
 * Everything a new project needs, ready for a front end to write and install.
 *
 * @experimental See the module note.
 */
export type AskDbScaffoldPlan = {
  /** The `askdb.config.ts` source. */
  configSource: string;
  /** The `.env.example` source: a `# purpose` line above each `NAME=`, every value empty. */
  envExample: string;
  /** Every env var the config reads, once each, database variables first. */
  envVars: { name: string; purpose: string; requiredForIntrospection: boolean }[];
  /** `packages` are `name@spec`, or a bare name for a driver at its latest version. `allowBuilds` are the builds pnpm must approve. */
  install: { packages: string[]; allowBuilds: string[] };
};

/**
 * An answer {@link planAskDbScaffold} can't use. `field` is the answer's path, such as
 * `connectionEnv` or `studioExecute.sqliteFile`; `reason` says what's wrong without naming
 * it, so a front end can name the field its own way (a flag, a form field).
 *
 * @experimental See the module note.
 */
export class AskDbScaffoldInputError extends Error {
  constructor(
    readonly field: string,
    readonly reason: string,
  ) {
    super(`\`${field}\` ${reason}`);
    this.name = "AskDbScaffoldInputError";
  }
}

const POSTGRES_URL = "postgresql://<USERNAME>:<PASSWORD>@<DATABASE_HOST>:<DATABASE_PORT>/<DATABASE_NAME>";

/**
 * `@askdb/core`'s `ai` peer and `zod` dependency. A Prisma project installs them next to
 * `@askdb/prisma`: under Yarn Plug'n'Play, core can only load them from the project (#760).
 * `ai` is the newest major in core's peer range, since one shell-safe spec can't hold the
 * whole `||` range. `plan.test.ts` fails when core's manifest moves.
 */
const CORE_AI = "ai@^7.0.51";
const CORE_ZOD = "zod@^4.6.7";

/** How each engine's config block finds its database, and what a project installs for it. */
type EngineFacts =
  | { connection: "url"; urlFormat: string; driver: string }
  | { connection: "file"; driver: string }
  | { connection: "schema"; packages: (versions: { prisma: string }) => string[]; allowBuilds: string[] };

const ENGINES: Record<AskDbIntrospectionProvider, EngineFacts> = {
  postgres: { connection: "url", urlFormat: POSTGRES_URL, driver: "pg" },
  mysql: {
    connection: "url",
    urlFormat: "mysql://<USERNAME>:<PASSWORD>@<DATABASE_HOST>:<DATABASE_PORT>/<DATABASE_NAME>",
    driver: "mysql2",
  },
  sqlserver: {
    connection: "url",
    urlFormat:
      "Data Source=<DATABASE_HOST>,<DATABASE_PORT>;Initial Catalog=<DATABASE_NAME>;User ID=<USERNAME>;Password=<PASSWORD>;Trust Server Certificate=True;Authentication=SqlPassword;",
    driver: "mssql",
  },
  sqlite: { connection: "file", driver: "better-sqlite3" },
  // `@askdb/prisma` depends on Prisma, whose `@prisma/engines` postinstall pnpm 11 refuses
  // to run unapproved (and then exits 1). A Prisma project approves it anyway.
  prisma: {
    connection: "schema",
    packages: ({ prisma }) => [`@askdb/prisma@${prisma}`, CORE_AI, CORE_ZOD],
    allowBuilds: ["@prisma/engines"],
  },
};

/**
 * Plans a new project's `askdb.config.ts`, `.env.example` and installs from `answers`.
 * `versions` are the `@askdb/config` and `@askdb/prisma` specs to install, which each front
 * end reads from its own manifest. Pure: it reads and writes nothing.
 *
 * Every value lands in the config as a JSON string literal, and ids that become object
 * keys are checked against their lists: the config runs when it loads.
 *
 * @throws {AskDbScaffoldInputError} for an env var name that isn't `^[A-Z_][A-Z0-9_]*$`,
 * a control character in a path, an unknown id, or a missing answer.
 * @experimental See the module note.
 */
export function planAskDbScaffold(
  answers: AskDbScaffoldAnswers,
  versions: { config: string; prisma: string },
): AskDbScaffoldPlan {
  const checked = checkAnswers(answers);
  const ai = renderAskDbAiConfigScaffold(checked.ai);
  const envVars = listEnvVars(checked, ai.envVars);
  return {
    configSource: renderConfig(checked, ai.source),
    envExample: envVars.renderEnvExample(),
    envVars: envVars.list(),
    install: installPlan(checked, versions),
  };
}

/** How a config block reaches a live database: a URL read from an env var, or a SQLite file. */
type Connection = { urlEnv: string } | { file: ScaffoldValue };

type CheckedAnswers = {
  database: AskDbIntrospectionProvider;
  /** The live connection, or for Prisma the schema path (`undefined`: auto-discovered). */
  introspection: Connection | { schemaPath: string | undefined };
  schemaOut: string;
  ai: AskDbAiConfigScaffoldInput;
  rag: { store: AskDbRagStore; pgvectorEnv: string | undefined };
  execute: { provider: AskDbStudioExecuteProvider; connection: Connection } | undefined;
};

/** The answers the chosen engine, store and execute provider read, each checked. Others are ignored. */
function checkAnswers(answers: AskDbScaffoldAnswers): CheckedAnswers {
  const database = checkOneOf("database", answers.database, ASKDB_INTROSPECTION_PROVIDERS);
  const introspection =
    ENGINES[database].connection === "schema"
      ? { schemaPath: answers.prismaSchemaPath === undefined ? undefined : checkPath("prismaSchemaPath", answers.prismaSchemaPath) }
      : connection(database, answers, "");
  const schemaOut = checkPath("schemaOut", answers.schemaOut);
  const ai = answers.ai as Partial<AskDbAiConfigScaffoldInput> | undefined;
  const provider = checkOneOf("ai.provider", ai?.provider, ASKDB_AI_PROVIDERS);
  const keyEnv = checkEnvName("ai.keyEnv", ai?.keyEnv);
  const modelEnv = ai?.modelEnv === undefined ? undefined : checkEnvName("ai.modelEnv", ai.modelEnv);
  const store = checkOneOf("rag.store", answers.rag?.store, ASKDB_RAG_STORES);
  const pgvectorEnv = store === "pgvector" ? checkEnvName("rag.pgvectorEnv", answers.rag.pgvectorEnv) : undefined;
  let execute: CheckedAnswers["execute"];
  if (answers.studioExecute) {
    const executeProvider = checkOneOf("studioExecute.provider", answers.studioExecute.provider, ASKDB_STUDIO_EXECUTE_PROVIDERS);
    execute = { provider: executeProvider, connection: connection(executeProvider, answers.studioExecute, "studioExecute.") };
  }
  return {
    database,
    introspection,
    schemaOut,
    ai: modelEnv === undefined ? { provider, keyEnv } : { provider, keyEnv, modelEnv },
    rag: { store, pgvectorEnv },
    execute,
  };
}

/** A live engine's connection from `answers`' `connectionEnv` or `sqliteFile`; `prefix` places them in the answers. */
function connection(
  engine: AskDbIntrospectionProvider,
  answers: { connectionEnv?: string; sqliteFile?: ScaffoldValue },
  prefix: string,
): Connection {
  return ENGINES[engine].connection === "url"
    ? { urlEnv: checkEnvName(`${prefix}connectionEnv`, answers.connectionEnv) }
    : { file: checkScaffoldValue(`${prefix}sqliteFile`, answers.sqliteFile) };
}

function renderConfig(a: CheckedAnswers, aiSource: string): string {
  const introspectionFields =
    "schemaPath" in a.introspection
      ? a.introspection.schemaPath === undefined
        ? []
        : [`schemaPath: ${tsString(a.introspection.schemaPath)}`]
      : [connectionField(a.introspection)];
  const sections = [
    aiSource,
    `  introspection: {
    provider: ${tsString(a.database)},
    providerConfig: {
      ${a.database}: ${block(introspectionFields, 6)},
    },
    outputDir: ${tsString(a.schemaOut)},
  },`,
    `  rag: {
    embedder: "mock",
    store: ${tsString(a.rag.store)},
    storeConfig: {
      ${a.rag.store}: ${a.rag.pgvectorEnv ? block([`databaseUrl: env(${tsString(a.rag.pgvectorEnv)})`], 6) : "{}"},
    },
  },`,
  ];
  if (a.execute) {
    const fields = ["enabled: true", `provider: ${tsString(a.execute.provider)}`, connectionField(a.execute.connection)];
    sections.push(`  studio: {
    execute: ${block(fields, 4)},
  },`);
  }
  return `import { defineConfig, env, type AskDbConfig } from "@askdb/config";

export default defineConfig({
${sections.join("\n")}
} satisfies AskDbConfig);
`;
}

function connectionField(c: Connection): string {
  return "urlEnv" in c ? `databaseUrl: env(${tsString(c.urlEnv)})` : `file: ${valueSource(c.file)}`;
}

/**
 * Every env var the config reads. Database variables come first, in the order `askdb init`
 * has always written them: the introspection URL, SQLite file variables, pgvector's URL,
 * then Studio execute's URL. Then the `ai` block's.
 */
function listEnvVars(a: CheckedAnswers, aiEnvVars: AskDbScaffoldEnvVar[]): EnvVarList {
  const envVars = new EnvVarList();
  const urlUse = (engine: AskDbIntrospectionProvider, c: Connection, use: string, requiredForIntrospection = false) => {
    const facts = ENGINES[engine];
    if ("urlEnv" in c && facts.connection === "url") {
      envVars.add(c.urlEnv, `${engine} connection URL`, use, { format: facts.urlFormat, requiredForIntrospection });
    }
  };
  const fileUse = (c: Connection, use: string, requiredForIntrospection = false) => {
    if ("file" in c && "env" in c.file) envVars.add(c.file.env, "SQLite database file path", use, { requiredForIntrospection });
  };
  const introspection = "schemaPath" in a.introspection ? undefined : a.introspection;
  if (introspection) urlUse(a.database, introspection, "introspection", true);
  if (introspection) fileUse(introspection, "introspection", true);
  if (a.execute) fileUse(a.execute.connection, "Studio execute");
  if (a.rag.pgvectorEnv) envVars.add(a.rag.pgvectorEnv, "pgvector connection URL", undefined, { format: POSTGRES_URL });
  if (a.execute) urlUse(a.execute.provider, a.execute.connection, "Studio execute");
  for (const { name, purpose } of aiEnvVars) envVars.add(name, purpose);
  return envVars;
}

/** `@askdb/config`, the engine's own packages, then each live driver the config connects with, once. */
function installPlan(a: CheckedAnswers, versions: { config: string; prisma: string }): AskDbScaffoldPlan["install"] {
  const packages = [`@askdb/config@${versions.config}`];
  const allowBuilds: string[] = [];
  const engine = ENGINES[a.database];
  if (engine.connection === "schema") {
    packages.push(...engine.packages(versions));
    allowBuilds.push(...engine.allowBuilds);
  }
  for (const id of [a.database, a.execute?.provider]) {
    const facts = id && ENGINES[id];
    if (facts && facts.connection !== "schema" && !packages.includes(facts.driver)) packages.push(facts.driver);
  }
  return { packages, allowBuilds };
}

/** POSIX env var names, uppercase. A leading `_` is allowed. */
const ENV_NAME_PATTERN = /^[A-Z_][A-Z0-9_]*$/;

// C0 controls, DEL, and the JS line and paragraph separators: never part of a project path.
const CONTROL_CHAR_PATTERN = /[\u0000-\u001f\u007f\u2028\u2029]/;

function checkRequired(field: string, value: unknown): string {
  if (typeof value !== "string" || value === "") throw new AskDbScaffoldInputError(field, "is required.");
  return value;
}

function checkEnvName(field: string, value: unknown): string {
  const name = checkRequired(field, value);
  if (!ENV_NAME_PATTERN.test(name)) {
    throw new AskDbScaffoldInputError(
      field,
      "must be an environment variable name like DATABASE_URL: uppercase letters, digits and underscores, not starting with a digit. Values belong in .env, not here.",
    );
  }
  return name;
}

function checkPath(field: string, value: unknown): string {
  const text = checkRequired(field, value);
  if (CONTROL_CHAR_PATTERN.test(text)) {
    throw new AskDbScaffoldInputError(field, "must not contain control characters, such as a newline.");
  }
  return text;
}

function checkScaffoldValue(field: string, value: ScaffoldValue | undefined): ScaffoldValue {
  if (value !== null && typeof value === "object") {
    if ("env" in value) return { env: checkEnvName(field, value.env) };
    if ("path" in value) return { path: checkPath(field, value.path) };
  }
  throw new AskDbScaffoldInputError(field, "is required: a path or an env var name.");
}

function checkOneOf<T extends string>(field: string, value: unknown, allowed: readonly T[]): T {
  if ((allowed as readonly unknown[]).includes(value)) return value as T;
  const expected = `one of: ${allowed.join(", ")}.`;
  throw new AskDbScaffoldInputError(field, value === undefined ? `is required, ${expected}` : `must be ${expected}`);
}

/** A string literal in the generated config: the file runs when it loads, so a quote in a value must not end the string. */
function tsString(value: string): string {
  return JSON.stringify(value);
}

function valueSource(value: ScaffoldValue): string {
  return "env" in value ? `env(${tsString(value.env)})` : tsString(value.path);
}

/** An object literal with one field per line, its closing brace indented by `indent`. */
function block(fields: string[], indent: number): string {
  const pad = " ".repeat(indent);
  return `{${fields.map((field) => `\n${pad}  ${field},`).join("")}\n${pad}}`;
}

type EnvVarEntry = {
  /** What the variable holds, mapped to what it's used for (`introspection`, …). */
  subjects: Map<string, string[]>;
  format: string | undefined;
  requiredForIntrospection: boolean;
};

/** The env vars a config reads, each once, in the order first added. A variable used twice lists both uses. */
class EnvVarList {
  private readonly entries = new Map<string, EnvVarEntry>();

  add(
    name: string,
    subject: string,
    use?: string,
    { format, requiredForIntrospection = false }: { format?: string; requiredForIntrospection?: boolean } = {},
  ): void {
    let entry = this.entries.get(name);
    if (!entry) {
      entry = { subjects: new Map(), format, requiredForIntrospection: false };
      this.entries.set(name, entry);
    }
    const uses = entry.subjects.get(subject) ?? [];
    if (use && !uses.includes(use)) uses.push(use);
    entry.subjects.set(subject, uses);
    entry.format ??= format;
    entry.requiredForIntrospection ||= requiredForIntrospection;
  }

  list(): AskDbScaffoldPlan["envVars"] {
    return [...this.entries].map(([name, entry]) => ({
      name,
      purpose: purpose(entry),
      requiredForIntrospection: entry.requiredForIntrospection,
    }));
  }

  renderEnvExample(): string {
    const lines = [
      "# AskDB environment — copy to .env and fill in real values.",
      "# .env is read by the CLI, Studio, and the HTTP API; never commit it.",
      "",
    ];
    for (const [name, entry] of this.entries) {
      lines.push(`# ${purpose(entry)}${entry.format ? `. Format: ${entry.format}` : ""}`, `${name}=`);
    }
    lines.push("");
    return lines.join("\n");
  }
}

function purpose(entry: EnvVarEntry): string {
  return [...entry.subjects]
    .map(([subject, uses]) => (uses.length > 0 ? `${subject}, for ${uses.join(" and ")}` : subject))
    .join("; ");
}
