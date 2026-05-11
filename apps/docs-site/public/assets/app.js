const pages = [
  {
    path: "/",
    title: "AskDB Documentation",
    eyebrow: "Natural language to governed SQL",
    description:
      "AskDB turns natural-language questions into schema-grounded SQL. Start with the CLI, embed the core library, or add retrieval over enriched schema artifacts when your schema gets large.",
    sections: [
      {
        heading: "What AskDB Gives You",
        body: `
          <div class="feature-grid">
            <article>
              <h3>Schema-grounded generation</h3>
              <p>Questions are grounded in an AskDB Schema v2 artifact before SQL is generated and validated.</p>
            </article>
            <article>
              <h3>Bring your own runtime</h3>
              <p>Use any AI SDK-compatible language model, any executor that returns tabular rows, and only install <code>pg</code> when you choose the built-in Postgres executor or pgvector store.</p>
            </article>
            <article>
              <h3>Schema enrichment tools</h3>
              <p>The TUI turns raw introspection output into described, aliased Schema v2 artifacts with human-reviewed AI suggestions.</p>
            </article>
            <article>
              <h3>Retrieval-ready context</h3>
              <p><code>@askdb/rag</code> chunks Schema v2, indexes it with your embedder and vector store, then passes focused context into <code>ask()</code>.</p>
            </article>
          </div>
        `,
      },
      {
        heading: "Choose a Path",
        body: `
          <div class="link-cards">
            <a href="#/quickstart"><strong>Run the CLI</strong><span>Use a committed fixture or introspect a Postgres database, then ask a question.</span></a>
            <a href="#/core"><strong>Embed AskDB</strong><span>Call <code>ask()</code> with your model, dialect, schema, and executor.</span></a>
            <a href="#/rag"><strong>Add retrieval</strong><span>Index enriched schema docs and retrieve only the chunks needed for each question.</span></a>
            <a href="#/postgres"><strong>Target Postgres</strong><span>Use the first-party dialect, introspection connector, catalog templates, and optional <code>pg</code> executor.</span></a>
          </div>
        `,
      },
      {
        heading: "First Run",
        body: `
          <p>Install dependencies, create a Schema v2 artifact, then ask a question against it.</p>
          <pre><code>pnpm install
cp .env.example .env
pnpm build

pnpm exec askdb introspect \\
  --url "$DATABASE_URL" \\
  --out my-app.schema \\
  --schema-id my-app

pnpm exec askdb enrich --schema my-app.schema

pnpm exec askdb ask \\
  --schema my-app.schema \\
  --question "Which tables look active?"</code></pre>
        `,
      },
      {
        heading: "Documentation Map",
        body: `
          <div class="link-cards">
            <a href="#/quickstart"><strong>Quickstart</strong><span>Local setup, schema creation, and your first question.</span></a>
            <a href="#/packages"><strong>Packages</strong><span>What each package owns and when to use it.</span></a>
            <a href="#/schema-v2"><strong>Schema v2</strong><span>The physical and describable schema artifact contract.</span></a>
            <a href="#/rag"><strong>RAG</strong><span>Chunk, index, and retrieve schema context with BYO embeddings and storage.</span></a>
            <a href="#/tui"><strong>TUI enrichment</strong><span>Add descriptions, aliases, concepts, and common query language.</span></a>
          </div>
        `,
      },
    ],
  },
  {
    path: "/quickstart",
    title: "Quickstart",
    eyebrow: "From clone to first query",
    description: "Build the workspace, generate or use a schema artifact, enrich it, and run AskDB from the CLI. The same pieces can then move into your application code.",
    sections: [
      {
        heading: "Prerequisites",
        body: `
          <ul>
            <li>Node 20 or newer.</li>
            <li>pnpm 11.</li>
            <li>An OpenAI-compatible API key for live NL-to-SQL generation.</li>
            <li>A PostgreSQL connection string only if you want live execution or live introspection.</li>
          </ul>
        `,
      },
      {
        heading: "Use the Bundled Fixture",
        body: `
          <p>The fastest path uses the sample Schema v2 directory committed under <code>fixtures/schemas/orders-users.schema</code>.</p>
          <pre><code>pnpm install
cp .env.example .env
# edit .env and set OPENAI_API_KEY
pnpm build

pnpm exec askdb ask \\
  --schema fixtures/schemas/orders-users.schema \\
  --question "How many orders are there?"</code></pre>
        `,
      },
      {
        heading: "Create a Schema from Postgres",
        body: `
          <p>For a real database, generate a Schema v2 directory first, then point AskDB at it.</p>
          <pre><code>pnpm exec askdb introspect \\
  --url "$DATABASE_URL" \\
  --out my-app.schema \\
  --schema-id my-app

pnpm exec askdb enrich --schema my-app.schema

pnpm exec askdb ask \\
  --schema my-app.schema \\
  --question "Which tables are connected to users?"</code></pre>
        `,
      },
      {
        heading: "Enrich the Schema",
        body: `
          <p>Raw introspection gives AskDB physical metadata. The TUI adds the describable layer: table descriptions, aliases, column notes, common query language, example questions, and concepts.</p>
          <pre><code>pnpm exec askdb enrich --schema my-app.schema

# produce a single read-only artifact for distribution
pnpm exec askdb bundle my-app.schema --out my-app.schema.bundle.json</code></pre>
        `,
      },
      {
        heading: "Execute Read-Only SQL",
        body: `
          <p>Generation works without a database connection. Execution requires <code>DATABASE_URL</code> and runs through the validated read-only path.</p>
          <pre><code>export DATABASE_URL="postgres://user:pass@localhost:5432/dbname"

pnpm exec askdb ask \\
  --schema my-app.schema \\
  --question "List the newest users" \\
  --execute \\
  --json</code></pre>
        `,
      },
      {
        heading: "Use the Packages",
        body: `
          <p>For application code, install the small set of packages that match the surface you need. <code>@askdb/core</code> is dialect-agnostic. Postgres-specific behavior lives in <code>@askdb/postgres</code>.</p>
          <pre><code>pnpm add @askdb/core @askdb/postgres
# Optional: only for the built-in Postgres executor or live Postgres introspection
pnpm add pg
# Optional: only when you want retrieval over schema chunks
pnpm add @askdb/rag</code></pre>
        `,
      },
    ],
  },
  {
    path: "/concepts",
    title: "Core Concepts",
    eyebrow: "How the pieces fit",
    description:
      "AskDB is built around schema artifacts, human-reviewed enrichment, validated SQL generation, optional execution, and explicit safety modes.",
    sections: [
      {
        heading: "Pipeline",
        body: `
          <ol>
            <li>Load an AskDB Schema v2 artifact from a directory, bundle, or <code>schema.json</code>.</li>
            <li>Optionally retrieve focused schema chunks from <code>@askdb/rag</code> for large enriched schemas.</li>
            <li>Build a prompt from physical schema metadata, describable context, and the selected dialect.</li>
            <li>Call the supplied language model to generate SQL.</li>
            <li>Validate that the SQL is a read-only PostgreSQL <code>SELECT</code>.</li>
            <li>Optionally execute it through a built-in or custom executor.</li>
          </ol>
        `,
      },
      {
        heading: "Integration Packages",
        body: `
          <p><code>@askdb/core</code> does not bundle database-specific behavior. It asks for an <code>AskDialect</code>, and integration packages provide those adapters. Today that means <code>@askdb/postgres</code>; future packages can own their own dialects, connectors, and input shapes without changing core.</p>
        `,
      },
      {
        heading: "Schema v2",
        body: `
          <p>Schema v2 is a directory with a physical JSON layer and optional markdown descriptions.</p>
          <pre><code>my-app.schema/
  schema.json
  tables/
    users.md
    orders.md
  concepts.md</code></pre>
        `,
      },
      {
        heading: "Enrichment",
        body: `
          <p><code>@askdb/tui</code> operates on a Schema v2 directory after introspection. It never opens a live database; it edits the on-disk artifact and saves valid <code>tables/&lt;table&gt;.md</code> plus concepts content.</p>
          <pre><code>askdb introspect --url "$DATABASE_URL" --out my-app.schema --schema-id my-app
askdb enrich --schema my-app.schema
askdb bundle my-app.schema --out my-app.schema.bundle.json</code></pre>
        `,
      },
      {
        heading: "Execution Boundary",
        body: `
          <p><code>@askdb/core</code> validates generated SQL before execution. Consumers still own database-level safety: read-only roles, read-only transactions, network policy, and audit logging. Installing <code>pg</code> is not required unless you choose a first-party adapter that uses it at runtime.</p>
        `,
      },
    ],
  },
  {
    path: "/packages",
    title: "Package Index",
    eyebrow: "Choose the right surface",
    description: "AskDB is split into focused packages so apps can adopt only the layers they need.",
    sections: [
      {
        heading: "Packages",
        body: `
          <div class="package-table">
            <a href="#/core"><strong>@askdb/core</strong><span>Dialect-agnostic library pipeline: schema loading, prompt assembly, generation, validation, optional execution, and retrieval input.</span></a>
            <a href="#/postgres"><strong>@askdb/postgres</strong><span>Postgres integration package: dialect, catalog connector, templates, bundle reader, and optional <code>pg</code> executor.</span></a>
            <a href="#/introspect"><strong>@askdb/introspect</strong><span>Engine-agnostic introspection orchestrator and Schema v2 renderer.</span></a>
            <a href="#/rag"><strong>@askdb/rag</strong><span>Schema v2 chunking, BYO embeddings, vector stores, lock-file reuse, and retriever wiring.</span></a>
            <a href="#/cli"><strong>@askdb/cli</strong><span>Batteries-included terminal frontend for asking questions and running Postgres introspection.</span></a>
            <a href="#/tui"><strong>@askdb/tui</strong><span>Interactive terminal authoring for descriptions, aliases, concepts, and AI suggestions.</span></a>
            <a href="#/http-api"><strong>@askdb/http-api</strong><span>Small HTTP wrapper around core for server deployments.</span></a>
          </div>
        `,
      },
      {
        heading: "Apps vs Libraries",
        body: `
          <p>The reusable contracts live in <code>packages/*</code>. The first-party product surfaces live in <code>apps/*</code>: CLI, HTTP API, TUI, and this docs site. That split keeps the embed API small while still shipping complete developer workflows.</p>
        `,
      },
      {
        heading: "Workspace Commands",
        body: `
          <pre><code>pnpm build
pnpm test
pnpm lint
pnpm smoke:install
pnpm preflight</code></pre>
        `,
      },
    ],
  },
  {
    path: "/core",
    title: "@askdb/core",
    eyebrow: "Library API",
    description:
      "The core package owns the NL-to-SQL pipeline, Schema v2 loading, enrichment suggestion helpers, logging contracts, retrieval input, and executor interfaces. It stays dialect-agnostic.",
    sections: [
      {
        heading: "Install",
        body: `
          <pre><code>pnpm add @askdb/core
# add an integration package for the engine you target
pnpm add @askdb/postgres</code></pre>
          <p><code>@askdb/core</code> does not depend on <code>pg</code> and does not expose a Postgres subpath. Database-specific behavior comes from integration packages such as <code>@askdb/postgres</code>.</p>
        `,
      },
      {
        heading: "Generate SQL",
        body: `
          <pre><code>import { ask, loadSchema } from "@askdb/core";
import { postgresDialect } from "@askdb/postgres";
import { createOpenAI } from "@ai-sdk/openai";

const schema = loadSchema("./my-app.schema");
const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });

const { sql } = await ask({
  question: "How many users signed up last week?",
  schema,
  model: openai("gpt-4o-mini"),
  dialect: postgresDialect,
});</code></pre>
        `,
      },
      {
        heading: "Execute with Postgres",
        body: `
          <p>Execution is explicit. Build an executor in the integration package and pass it to <code>ask()</code>. This path is where the built-in Postgres adapter uses <code>pg</code>.</p>
          <pre><code>import { ask, loadSchema } from "@askdb/core";
import { createPostgresExecutor, postgresDialect } from "@askdb/postgres";

const schema = loadSchema("./my-app.schema");

const { sql, result } = await ask({
  question: "Top customers by lifetime value",
  schema,
  model,
  dialect: postgresDialect,
  executor: createPostgresExecutor(process.env.DATABASE_URL!),
  execute: true,
});</code></pre>
        `,
      },
      {
        heading: "BYO Executor",
        body: `
          <pre><code>import { ask, loadSchema, type AskDbExecutor } from "@askdb/core";
import { postgresDialect } from "@askdb/postgres";

const schema = loadSchema("./my-app.schema");

const executor: AskDbExecutor = async (sql) => {
  // Run sql in your own read-only transaction.
  return { columns: ["x"], rows: [[1]] };
};

await ask({
  question,
  schema,
  model,
  dialect: postgresDialect,
  executor,
  execute: true,
});</code></pre>
          <p>Use this path for <code>postgres.js</code>, Neon HTTP, Cloudflare Hyperdrive, a database proxy, an MCP-mediated database, or any other driver that can run the validated SQL and return <code>{ columns, rows }</code>.</p>
        `,
      },
      {
        heading: "Retrieval Input",
        body: `
          <p>Phase 8 adds an optional <code>retriever</code> to <code>ask()</code>. When present, core asks the retriever for relevant Schema v2 chunks and builds a focused DDL block. Without a retriever, the existing full-schema prompt path is preserved.</p>
          <pre><code>const { sql } = await ask({
  question,
  schema,
  model,
  dialect: postgresDialect,
  retriever: index.retriever,
  totalSchemaChunkCount: index.stats.chunksTotal,
});</code></pre>
        `,
      },
      {
        heading: "Enrichment Suggestions",
        body: `
          <p>Phase 7 adds core helpers used by the TUI to ask a model for human-reviewed schema enrichment candidates.</p>
          <pre><code>import {
  suggestEnrichment,
  type EnrichmentTarget,
} from "@askdb/core";

const target: EnrichmentTarget = {
  kind: "table-description",
  table,
};

const candidates = await suggestEnrichment(
  target,
  { schemaId: "my-app", neighbors },
  model,
);</code></pre>
        `,
      },
      {
        heading: "Exports to Know",
        body: `
          <ul>
            <li><code>ask</code>: generate and optionally execute SQL.</li>
            <li><code>AskDialect</code>: dialect adapter contract consumed by <code>ask()</code>.</li>
            <li><code>loadSchema</code>: load a Schema v2 directory, bundle, or schema JSON path.</li>
            <li><code>loadSchemaFromJson</code>: parse inline Schema v2 JSON.</li>
            <li><code>parseTableMarkdown</code> and <code>writeTableMarkdown</code>: work with describable table docs.</li>
            <li><code>suggestEnrichment</code>: produce candidate descriptions, aliases, primary entities, and common query language for review.</li>
            <li><code>createAskDbLogger</code>: produce structured log events.</li>
          </ul>
        `,
      },
    ],
  },
  {
    path: "/postgres",
    title: "@askdb/postgres",
    eyebrow: "Postgres integration",
    description:
      "The Postgres package owns everything that is specific to PostgreSQL: the dialect adapter, catalog introspection connector, template bundle, and optional pg-backed executor.",
    sections: [
      {
        heading: "Install",
        body: `
          <pre><code>pnpm add @askdb/core @askdb/postgres
# only when using createPostgresExecutor
pnpm add pg</code></pre>
          <p><code>pg</code> is an optional peer dependency. The package can still provide the dialect, templates, and connector types without forcing a driver into applications that supply their own executor.</p>
        `,
      },
      {
        heading: "What It Provides",
        body: `
          <div class="definition-list">
            <div><code>postgresDialect</code><span>Prompting, SQL generation, and validation rules for read-only Postgres <code>SELECT</code> statements.</span></div>
            <div><code>createPostgresExecutor()</code><span>A read-only executor backed by <code>pg</code>, lazy-loaded when called.</span></div>
            <div><code>createPostgresConnector()</code><span>The connector used by <code>@askdb/introspect</code> for live and from-export catalog reads.</span></div>
            <div><code>POSTGRES_TEMPLATE_BUNDLE</code><span>The catalog SQL suite for air-gapped exports and documented inspection.</span></div>
          </div>
        `,
      },
      {
        heading: "Ask with Postgres",
        body: `
          <pre><code>import { ask, loadSchema } from "@askdb/core";
import { createPostgresExecutor, postgresDialect } from "@askdb/postgres";

const schema = loadSchema("./my-app.schema");

await ask({
  question: "How many paid orders were created last month?",
  schema,
  model,
  dialect: postgresDialect,
  executor: createPostgresExecutor(process.env.DATABASE_URL!),
  execute: true,
});</code></pre>
        `,
      },
      {
        heading: "Introspect with Postgres",
        body: `
          <pre><code>import { introspect } from "@askdb/introspect";
import { createPostgresConnector, createPostgresExecutor } from "@askdb/postgres";

await introspect(
  { mode: "live", executor: createPostgresExecutor(process.env.DATABASE_URL!) },
  { outDir: "./my-app.schema", schemaId: "my-app" },
  { connector: createPostgresConnector() },
);</code></pre>
        `,
      },
      {
        heading: "Why This Split Exists",
        body: `
          <p><code>@askdb/core</code> should be usable by teams that do not use <code>pg</code>, or eventually do not use Postgres at all. Keeping Postgres behavior in one integration package makes the dependency boundary explicit and gives future integrations, such as Prisma-shaped schema inputs, their own honest API shape.</p>
        `,
      },
    ],
  },
  {
    path: "/cli",
    title: "@askdb/cli",
    eyebrow: "Terminal workflow",
    description:
      "The CLI ships the `askdb` binary for asking questions, generating SQL, optional execution, logging, introspection, enrichment, and bundling.",
    sections: [
      {
        heading: "Install",
        body: `
          <pre><code>pnpm add -g @askdb/cli
# or run from a workspace clone
pnpm exec askdb --help</code></pre>
          <p>The CLI is the batteries-included workflow and ships with the Postgres executor dependency. Library consumers can keep <code>pg</code> optional by using <code>@askdb/core</code> and <code>@askdb/postgres</code> directly.</p>
        `,
      },
      {
        heading: "Ask",
        body: `
          <pre><code>askdb ask \\
  --schema ./my-app.schema \\
  --question "Top 5 customers by lifetime value"</code></pre>
        `,
      },
      {
        heading: "Execute",
        body: `
          <pre><code>export DATABASE_URL="postgres://user:pass@host:5432/db"

askdb ask \\
  --schema ./my-app.schema \\
  --question "List user emails" \\
  --execute \\
  --mode bounded_results</code></pre>
        `,
      },
      {
        heading: "Introspect",
        body: `
          <pre><code>askdb introspect \\
  --url "$DATABASE_URL" \\
  --out ./my-app.schema \\
  --schema-id my-app</code></pre>
          <p>The retired standalone <code>askdb-introspect</code> binary is no longer the documented path.</p>
        `,
      },
      {
        heading: "Enrich and Bundle",
        body: `
          <p>When <code>@askdb/tui</code> is installed, the main CLI exposes thin shims for interactive enrichment and bundle creation.</p>
          <pre><code>askdb enrich --schema ./my-app.schema
askdb bundle ./my-app.schema --out ./my-app.schema.bundle.json</code></pre>
        `,
      },
      {
        heading: "Useful Flags",
        body: `
          <div class="definition-list">
            <div><code>--schema &lt;path&gt;</code><span>Path to a Schema v2 directory, bundle, or schema JSON.</span></div>
            <div><code>--execute</code><span>Run generated SQL after validation.</span></div>
            <div><code>--json</code><span>Emit executed rows as JSON instead of TSV.</span></div>
            <div><code>--mode &lt;id&gt;</code><span>Select <code>schema_only</code> or <code>bounded_results</code>.</span></div>
            <div><code>--explain</code><span>Print heuristic guardrail metadata.</span></div>
            <div><code>--log-file &lt;path&gt;</code><span>Append structured JSON logs to a file.</span></div>
          </div>
        `,
      },
    ],
  },
  {
    path: "/introspect",
    title: "@askdb/introspect",
    eyebrow: "Schema creation",
    description:
      "The introspection package is engine-agnostic. It defines the connector contract, runs an integration package, and writes the physical layer of a Schema v2 directory.",
    sections: [
      {
        heading: "Install",
        body: `
          <pre><code>pnpm add @askdb/introspect
# add the integration package for the source you want to inspect
pnpm add @askdb/postgres</code></pre>
          <p><code>@askdb/introspect</code> does not ship a default database connector or a standalone binary. Use <code>@askdb/cli</code> for the command-line workflow.</p>
        `,
      },
      {
        heading: "CLI Workflow",
        body: `
          <pre><code>askdb introspect \\
  --url "$DATABASE_URL" \\
  --out my-app.schema \\
  --schema-id my-app</code></pre>
          <p>For Postgres, the CLI wires <code>@askdb/introspect</code> to <code>@askdb/postgres</code> and writes <code>schema.json</code> into the output directory.</p>
        `,
      },
      {
        heading: "Air-Gapped Mode",
        body: `
          <p>Use export bundles when AskDB should not connect to the database.</p>
          <pre><code>askdb introspect templates --engine postgres > pg-introspection.sql

askdb introspect \\
  --from-export ./pg-export \\
  --out my-app.schema \\
  --schema-id my-app</code></pre>
        `,
      },
      {
        heading: "Re-Introspection",
        body: `
          <p>Re-running against an existing output directory updates <code>schema.json</code> while preserving the describable layer.</p>
          <ul>
            <li>Existing table and column IDs are preserved.</li>
            <li>Existing physical <code>sensitive</code> flags are preserved.</li>
            <li>New columns emit <code>new_column</code> warnings.</li>
            <li>Removed IDs referenced by markdown emit <code>orphan_id</code> warnings.</li>
          </ul>
        `,
      },
      {
        heading: "Handoff to Enrichment",
        body: `
          <p>Introspection writes physical metadata only. After creating the directory, open it in the TUI to author the describable layer.</p>
          <pre><code>askdb introspect --url "$DATABASE_URL" --out my-app.schema --schema-id my-app
askdb-tui --schema my-app.schema</code></pre>
        `,
      },
      {
        heading: "Library API",
        body: `
          <pre><code>import { introspect } from "@askdb/introspect";
import { createPostgresConnector, createPostgresExecutor } from "@askdb/postgres";

await introspect(
  {
    mode: "live",
    executor: createPostgresExecutor(process.env.DATABASE_URL!),
    filters: { schemas: ["public"] },
  },
  {
    outDir: "my-app.schema",
    schemaId: "my-app",
  },
  { connector: createPostgresConnector() },
);</code></pre>
          <p>The input shape is owned by the integration package. For Postgres that shape is <code>PostgresIntrospectionInput</code>; another integration can use a different shape without changing <code>@askdb/introspect</code>.</p>
        `,
      },
    ],
  },
  {
    path: "/tui",
    title: "@askdb/tui",
    eyebrow: "Interactive enrichment",
    description:
      "The TUI opens a Schema v2 directory and helps authors add descriptions, aliases, common query language, example questions, and concepts with AI-suggest plus human-confirm.",
    sections: [
      {
        heading: "Install",
        body: `
          <pre><code>pnpm add @askdb/tui
# commonly installed with the CLI and introspector
pnpm add @askdb/cli @askdb/introspect @askdb/postgres @askdb/tui</code></pre>
        `,
      },
      {
        heading: "Quick Start",
        body: `
          <pre><code>askdb introspect \\
  --url "$DATABASE_URL" \\
  --out my-app.schema \\
  --schema-id my-app

askdb-tui --schema my-app.schema</code></pre>
          <p>The TUI operates on the on-disk Schema v2 directory only. It does not connect to the database.</p>
        `,
      },
      {
        heading: "Authoring Flow",
        body: `
          <ul>
            <li>Select a table, then edit table descriptions, aliases, primary entity, columns, and common query language.</li>
            <li>Use <code>g</code> on supported fields to request AI suggestions when <code>OPENAI_API_KEY</code> is set.</li>
            <li>Accept, edit, or reject suggestions before saving.</li>
            <li>Press <code>s</code> to write valid Schema v2 markdown through the core writer.</li>
          </ul>
        `,
      },
      {
        heading: "CLI Shims",
        body: `
          <p>The main <code>askdb</code> binary can delegate to the TUI package when it is installed.</p>
          <pre><code>askdb enrich --schema my-app.schema
askdb bundle my-app.schema --out my-app.schema.bundle.json</code></pre>
        `,
      },
      {
        heading: "Output",
        body: `
          <p>Saving writes <code>tables/&lt;table&gt;.md</code> and concept content in the Schema v2 format. Bundling produces a single <code>*.schema.bundle.json</code> that <code>loadSchema</code> can read like the directory form.</p>
        `,
      },
    ],
  },
  {
    path: "/rag",
    title: "@askdb/rag",
    eyebrow: "Schema retrieval",
    description:
      "The RAG package turns enriched Schema v2 artifacts into deterministic chunks, indexes them with your embedder and vector store, and returns a retriever for @askdb/core.",
    sections: [
      {
        heading: "Install",
        body: `
          <pre><code>pnpm add @askdb/rag @askdb/core
# only for the pgvector store when passing a connection string
pnpm add pg</code></pre>
          <p>The chunker, in-memory store, and file store do not require <code>pg</code>. The pgvector adapter can also use a pre-built client so applications can keep driver ownership outside AskDB.</p>
        `,
      },
      {
        heading: "Index a Schema",
        body: `
          <pre><code>import { buildSchemaIndex, loadChunkerSourcesFromDir } from "@askdb/rag";
import { createFileStore } from "@askdb/rag/stores/file";

const schemaDir = "./my-app.schema";
const sources = loadChunkerSourcesFromDir(schemaDir);

const index = await buildSchemaIndex({
  schema: sources,
  embedder,
  store: createFileStore({ basePath: "./my-app.schema/schema" }),
  embedderId: "openai:text-embedding-3-small",
  lockFilePath: "./my-app.schema/schema.lock.json",
});</code></pre>
          <p>The lock file records chunk content hashes so unchanged schema text can skip re-embedding on the next run.</p>
        `,
      },
      {
        heading: "Ask with Retrieval",
        body: `
          <pre><code>import { ask, loadSchema } from "@askdb/core";
import { postgresDialect } from "@askdb/postgres";

const schema = loadSchema("./my-app.schema");

const { sql } = await ask({
  question: "How much revenue did we make last month?",
  schema,
  model,
  dialect: postgresDialect,
  retriever: index.retriever,
  totalSchemaChunkCount: index.stats.chunksTotal,
});</code></pre>
          <p>Core still validates against the dialect. Retrieval changes how much schema context is sent to the model; it does not bypass SQL guardrails.</p>
        `,
      },
      {
        heading: "CLI",
        body: `
          <pre><code>askdb-rag index ./my-app.schema --store file --embedder openai
askdb-rag query ./my-app.schema \\
  --question "How much revenue did we make last month?" \\
  -k 8</code></pre>
          <p>The default CLI embedder is a deterministic mock for smoke tests. Use <code>--embedder openai</code> with <code>OPENAI_API_KEY</code> for real embeddings.</p>
        `,
      },
      {
        heading: "Stores",
        body: `
          <div class="definition-list">
            <div><code>memory</code><span>Ephemeral cosine store for tests and local smoke checks.</span></div>
            <div><code>file</code><span>Binary embeddings plus JSON metadata persisted next to the schema.</span></div>
            <div><code>pgvector</code><span>Postgres vector storage; setup SQL is documented and intentionally not auto-run.</span></div>
          </div>
        `,
      },
      {
        heading: "Sensitive Content",
        body: `
          <p>Sensitive describable-layer content and sensitive identifiers are excluded from chunks by default. Identifier grounding remains in core prompt formatting, where sensitive columns are tagged unless the caller explicitly omits them.</p>
        `,
      },
    ],
  },
  {
    path: "/http-api",
    title: "@askdb/http-api",
    eyebrow: "Server wrapper",
    description:
      "The HTTP API exposes a minimal server around @askdb/core. POST /ask returns validated read-only SQL, with execution gated by server config.",
    sections: [
      {
        heading: "Run Locally",
        body: `
          <pre><code>pnpm -C apps/http-api build
node apps/http-api/dist/bin.js</code></pre>
          <p>Set <code>ASKDB_SCHEMA_PATH</code> in the repo-root <code>.env</code> before starting the server.</p>
        `,
      },
      {
        heading: "Health Check",
        body: `
          <pre><code>curl -sS http://127.0.0.1:3000/health</code></pre>
        `,
      },
      {
        heading: "Ask Endpoint",
        body: `
          <pre><code>curl -sS http://127.0.0.1:3000/ask \\
  -H 'content-type: application/json' \\
  -H 'x-correlation-id: demo-123' \\
  -d '{
    "question": "How many users are there?"
  }'</code></pre>
        `,
      },
      {
        heading: "Execution Gate",
        body: `
          <p>Execution is disabled by default. Requests that set <code>execute: true</code> or <code>x-askdb-execute: true</code> receive <code>403</code> unless the server has <code>ASKDB_HTTP_ENABLE_EXECUTION=true</code>.</p>
        `,
      },
    ],
  },
  {
    path: "/schema-v2",
    title: "Schema v2",
    eyebrow: "Artifact contract",
    description:
      "Schema v2 is a describable schema artifact: one physical JSON layer, optional markdown table docs, optional concepts, and bundle output for distribution.",
    sections: [
      {
        heading: "Layout",
        body: `
          <pre><code>my-app.schema/
  schema.json
  tables/
    users.md
    orders.md
  concepts.md
  schema.lock.json</code></pre>
          <p>Only <code>schema.json</code> is required. A directory with no table markdown files is valid.</p>
        `,
      },
      {
        heading: "Physical Layer",
        body: `
          <p><code>schema.json</code> stores stable table and column IDs, physical names, data types, nullability, primary keys, relationships, and sensitivity flags.</p>
          <pre><code>{
  "version": 2,
  "schemaId": "orders-users",
  "tables": [
    {
      "id": "table:users",
      "name": "users",
      "columns": [
        {
          "id": "table:users#email",
          "name": "email",
          "type": "text",
          "nullable": false,
          "sensitive": true
        }
      ]
    }
  ]
}</code></pre>
        `,
      },
      {
        heading: "Describable Layer",
        body: `
          <p><code>tables/&lt;name&gt;.md</code> adds aliases, descriptions, examples, common query language, and business context without changing physical metadata.</p>
          <pre><code>---
id: table:orders
name: orders
schemaId: my-app
aliases: [purchases, sales]
columns:
  - id: table:orders#status
    enum: [pending, paid, shipped, cancelled]
    description: Order lifecycle state.
---

# Table: orders

Customer purchase orders. One row per submitted order.

## Common query language

- "sales" usually means paid orders</code></pre>
        `,
      },
      {
        heading: "Enrichment Workflow",
        body: `
          <p>The intended authoring flow is introspect, enrich, re-introspect as the database changes, then bundle when another service needs one file.</p>
          <pre><code>askdb introspect --url "$DATABASE_URL" --out my-app.schema --schema-id my-app
askdb enrich --schema my-app.schema
askdb bundle my-app.schema --out my-app.schema.bundle.json</code></pre>
        `,
      },
      {
        heading: "Stable IDs",
        body: `
          <div class="definition-list">
            <div><code>table:users</code><span>Table ID.</span></div>
            <div><code>table:users#email</code><span>Column ID.</span></div>
            <div><code>concept:customer</code><span>Cross-table concept ID.</span></div>
          </div>
        `,
      },
    ],
  },
  {
    path: "/modes",
    title: "Modes and Safety",
    eyebrow: "Guardrails",
    description:
      "AskDB validates generated SQL and supports operating modes that control post-execution behavior and reporting boundaries.",
    sections: [
      {
        heading: "SQL Validation",
        body: `
          <p>Generated SQL is expected to be a PostgreSQL read-only <code>SELECT</code>. Guardrails reject writes, multi-statements, and system-schema access.</p>
        `,
      },
      {
        heading: "schema_only",
        body: `
          <p>The default mode. AskDB grounds generation in schema context and skips post-execution report generation.</p>
          <pre><code>askdb ask \\
  --schema my-app.schema \\
  --question "How many orders?" \\
  --mode schema_only</code></pre>
        `,
      },
      {
        heading: "bounded_results",
        body: `
          <p>Designed for workflows that execute SQL and then summarize bounded tabular results. Current implementation emits the mode-specific post-execute branch as a structured log event.</p>
          <pre><code>askdb ask \\
  --schema my-app.schema \\
  --question "Show recent signups" \\
  --execute \\
  --mode bounded_results \\
  -v</code></pre>
        `,
      },
      {
        heading: "Sensitive Fields",
        body: `
          <p>Sensitive column and table markers can be included in prompts as tagged names, or omitted with <code>--omit-sensitive-from-prompt</code> / <code>ASKDB_OMIT_SENSITIVE_FROM_PROMPT</code>.</p>
        `,
      },
    ],
  },
  {
    path: "/environment",
    title: "Environment",
    eyebrow: "Configuration",
    description: "Use a local .env file for secrets and runtime defaults. The CLI loads .env automatically.",
    sections: [
      {
        heading: "Common Variables",
        body: `
          <div class="definition-list">
            <div><code>OPENAI_API_KEY</code><span>Required for live NL-to-SQL generation.</span></div>
            <div><code>OPENAI_BASE_URL</code><span>Optional custom OpenAI-compatible base URL.</span></div>
            <div><code>ASKDB_MODEL</code><span>Optional model ID; defaults are package-specific.</span></div>
            <div><code>DATABASE_URL</code><span>Required only for CLI execution, live Postgres introspection, or examples that create a Postgres-backed executor.</span></div>
            <div><code>ASKDB_SCHEMA_PATH</code><span>Default schema path for CLI and HTTP server workflows.</span></div>
            <div><code>ASKDB_LOG_LEVEL</code><span>Structured log level.</span></div>
            <div><code>ASKDB_MODE</code><span>Default operating mode.</span></div>
            <div><code>ASKDB_OMIT_SENSITIVE_FROM_PROMPT</code><span>Omit sensitive identifiers from generation prompts when set to a truthy value.</span></div>
          </div>
        `,
      },
      {
        heading: "TUI Suggestions",
        body: `
          <p><code>@askdb/tui</code> uses <code>OPENAI_API_KEY</code> when you press <code>g</code> to request AI enrichment suggestions. Without the key, the TUI still supports manual authoring and saving.</p>
        `,
      },
      {
        heading: "RAG Embeddings",
        body: `
          <p><code>askdb-rag</code> defaults to a deterministic mock embedder for smoke tests. Set <code>OPENAI_API_KEY</code> and pass <code>--embedder openai</code> when you want real embeddings; pass <code>--pg-url</code> only when using the pgvector store.</p>
        `,
      },
      {
        heading: "Local Template",
        body: `
          <pre><code>cp .env.example .env
# edit .env before calling a live model or database</code></pre>
        `,
      },
    ],
  },
];

const content = document.querySelector("#content");
const toc = document.querySelector("[data-toc]");
const searchInput = document.querySelector("#docs-search");
const searchPanel = document.querySelector("[data-search-panel]");
const sidebar = document.querySelector("[data-sidebar]");
const navToggle = document.querySelector("[data-nav-toggle]");
const navLinks = Array.from(document.querySelectorAll("[data-nav-link]"));

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function getCurrentPath() {
  const hash = window.location.hash.replace(/^#/, "");
  return hash.startsWith("/") ? hash : "/";
}

function renderPage() {
  const path = getCurrentPath();
  const page = pages.find((candidate) => candidate.path === path) ?? pages[0];
  document.title = `${page.title} - AskDB Docs`;

  const sections = page.sections
    .map((section) => {
      const id = slugify(section.heading);
      return `
        <section class="doc-section" id="${id}">
          <h2>${escapeHtml(section.heading)}</h2>
          ${section.body}
        </section>
      `;
    })
    .join("");

  content.innerHTML = `
    <article class="doc-page">
      <div class="hero">
        <p class="eyebrow">${escapeHtml(page.eyebrow)}</p>
        <h1>${escapeHtml(page.title)}</h1>
        <p>${escapeHtml(page.description)}</p>
      </div>
      ${sections}
    </article>
  `;

  toc.innerHTML = page.sections
    .map(
      (section) =>
        `<button type="button" data-scroll-target="${slugify(section.heading)}">${escapeHtml(
          section.heading,
        )}</button>`,
    )
    .join("");

  navLinks.forEach((link) => {
    link.toggleAttribute("aria-current", link.dataset.navLink === page.path);
  });

  sidebar.classList.remove("is-open");
  content.focus({ preventScroll: true });
}

function buildSearchIndex() {
  return pages.map((page) => ({
    path: page.path,
    title: page.title,
    description: page.description,
    text: `${page.title} ${page.eyebrow} ${page.description} ${page.sections
      .map((section) => `${section.heading} ${section.body.replace(/<[^>]*>/g, " ")}`)
      .join(" ")}`.toLowerCase(),
  }));
}

const searchIndex = buildSearchIndex();

function renderSearchResults(query) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    searchPanel.hidden = true;
    searchPanel.innerHTML = "";
    return;
  }

  const matches = searchIndex
    .map((entry) => ({
      ...entry,
      score: normalized
        .split(/\s+/)
        .filter(Boolean)
        .reduce((score, token) => score + (entry.text.includes(token) ? 1 : 0), 0),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);

  searchPanel.hidden = false;
  searchPanel.innerHTML = matches.length
    ? matches
        .map(
          (entry) => `
            <a href="#${entry.path}" data-search-result>
              <strong>${escapeHtml(entry.title)}</strong>
              <span>${escapeHtml(entry.description)}</span>
            </a>
          `,
        )
        .join("")
    : `<p>No results for <strong>${escapeHtml(query)}</strong>.</p>`;
}

window.addEventListener("hashchange", renderPage);
navToggle.addEventListener("click", () => sidebar.classList.toggle("is-open"));
searchInput.addEventListener("input", (event) => renderSearchResults(event.target.value));
searchPanel.addEventListener("click", (event) => {
  if (event.target.closest("[data-search-result]")) {
    searchInput.value = "";
    searchPanel.hidden = true;
  }
});
toc.addEventListener("click", (event) => {
  const button = event.target.closest("[data-scroll-target]");
  if (!button) {
    return;
  }

  document.getElementById(button.dataset.scrollTarget)?.scrollIntoView({
    behavior: "smooth",
    block: "start",
  });
});
document.addEventListener("keydown", (event) => {
  if (event.key === "/" && document.activeElement !== searchInput) {
    event.preventDefault();
    searchInput.focus();
  }
  if (event.key === "Escape") {
    sidebar.classList.remove("is-open");
    searchPanel.hidden = true;
    searchInput.blur();
  }
});

renderPage();
