import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ENV_TEMPLATE = `# Copy to \`.env\` for local development (do not commit \`.env\`).
# The \`askdb\` CLI loads \`.env\` automatically (via \`dotenv\`) and then reads \`process.env\`.

# Required for NL→SQL (OpenAI-compatible)
OPENAI_API_KEY=

# Optional: custom OpenAI-compatible API base URL
# OPENAI_BASE_URL=

# Optional: model id (defaults to gpt-4o-mini if unset)
ASKDB_MODEL=gpt-4o-mini
# OPENAI_MODEL=

# Optional: required when using \`askdb ask --execute\`
# DATABASE_URL=postgres://user:password@localhost:5432/database
#
# Pagila dev fixture (docker compose -f fixtures/pagila/docker-compose.yml up --build -d → port 5433):
# DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5433/pagila

# Optional: required when using the RAG pgvector store
# ASKDB_PGVECTOR_URL=postgres://user:password@localhost:5432/vector_database
#
# pgvector dev fixture (docker compose -f fixtures/pgvector/docker-compose.yml up -d → port 5434):
# ASKDB_PGVECTOR_URL=postgres://postgres:postgres@127.0.0.1:5434/askdb_rag

# Optional: Studio RAG embedder. Defaults to the configured AskDB AI SDK
# connection when an embedding-capable key is configured, otherwise falls back
# to a local mock lexical embedder.
# ASKDB_RAG_EMBEDDER=mock
# ASKDB_RAG_EMBEDDER=ai-sdk
# ASKDB_RAG_EMBEDDER=openai                 # compatibility alias for AI SDK OpenAI
# Uses the configured AskDB AI connection URL (ASKDB_AI_BASE_URL / provider-native base URL).
# ASKDB_RAG_EMBEDDER_MODEL=text-embedding-3-small
# ASKDB_RAG_EMBEDDER_DIMENSIONS=1536
# Azure/Foundry can use a separate embedding deployment/model name from the chat deployment:
# AZURE_OPENAI_EMBEDDING_DEPLOYMENT=text-embedding-3-small

# Optional: Phase 2 structured logs (Pino JSON lines). Default silent unless CLI flags imply info.
# ASKDB_LOG_LEVEL=info
# ASKDB_CORRELATION_ID=

# Optional: Phase 2 operating mode — schema_only | bounded_results (see docs/contracts/modes-v1.md)
# ASKDB_MODE=schema_only

# Optional: omit sensitive table/column *names* from NL→SQL DDL (default: include names, tagged sensitive)
# ASKDB_OMIT_SENSITIVE_FROM_PROMPT=true

# Optional (HTTP API / other hosts): default schema configured server-side
# ASKDB_SCHEMA_PATH=fixtures/schemas/orders-users.schema.json
# ASKDB_SCHEMA_JSON={"version":1,"tables":[...]}  # prefer ASKDB_SCHEMA_PATH
`;

type InitOptions = {
  force: boolean;
  path: string;
};

export function runInitCli(argv: readonly string[]): number {
  let opts: InitOptions;
  try {
    opts = parseOptions(argv);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`${msg}\n`);
    return 1;
  }

  if (opts.path === "--help" || opts.path === "-h") {
    printHelp();
    return 0;
  }

  const target = resolve(process.cwd(), opts.path);

  if (existsSync(target) && !opts.force) {
    process.stderr.write(
      `Refusing to overwrite existing file: ${target}\n` +
        `Use \`askdb init --force\` to overwrite.\n`,
    );
    return 1;
  }

  try {
    writeFileSync(target, ENV_TEMPLATE, { encoding: "utf8" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`Failed to write ${target}: ${msg}\n`);
    return 1;
  }

  process.stdout.write(
    `Wrote ${target}\n` +
      "Next steps:\n" +
      "  1. Edit the file and set OPENAI_API_KEY (and DATABASE_URL if you'll use introspect).\n" +
      "  2. Run `askdb ask --schema <path> --question \"...\"`.\n",
  );
  return 0;
}

function parseOptions(argv: readonly string[]): InitOptions {
  const opts: InitOptions = { force: false, path: ".env" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    switch (arg) {
      case "--force":
      case "-f":
        opts.force = true;
        break;
      case "--path": {
        const value = argv[++i];
        if (!value || value.startsWith("--")) {
          throw new Error(`${arg} requires a value.`);
        }
        opts.path = value;
        break;
      }
      case "--help":
      case "-h":
        opts.path = "--help";
        return opts;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }
  return opts;
}

function printHelp(): void {
  process.stdout.write(
    [
      "askdb init - Create a local .env from the AskDB template",
      "",
      "Usage:",
      "  askdb init             Create ./.env (refuses to overwrite an existing file)",
      "  askdb init --force     Overwrite an existing .env",
      "  askdb init --path <p>  Write to a custom path instead of ./.env",
      "",
    ].join("\n"),
  );
}
