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
              <p>Use any AI SDK-compatible language model. Install <code>pg</code> only when you choose live Postgres introspection or the pgvector store.</p>
            </article>
            <article>
              <h3>Schema enrichment tools</h3>
              <p><code>@askdb/enrich</code> provides shared authoring logic; the TUI and Studio turn raw introspection output into described, aliased Schema v2 artifacts with human-reviewed AI suggestions.</p>
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
            <a href="#/core"><strong>Embed AskDB</strong><span>Call <code>ask()</code> with your model, dialect, and schema to return validated SQL.</span></a>
            <a href="#/rag"><strong>Add retrieval</strong><span>Index enriched schema docs and retrieve only the chunks needed for each question.</span></a>
            <a href="#/postgres"><strong>Target Postgres</strong><span>Use the first-party dialect, introspection connector, catalog templates, and optional <code>pg</code> catalog runner.</span></a>
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
            <li>A PostgreSQL connection string only if you want live introspection.</li>
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
        heading: "SQL Output Only",
        body: `
          <p>AskDB returns validated SQL. Run it through your own application, approval flow, or database tooling outside AskDB.</p>
          <pre><code>pnpm exec askdb ask \\
  --schema my-app.schema \\
  --question "List the newest users"</code></pre>
        `,
      },
      {
        heading: "Use the Packages",
        body: `
          <p>For application code, install the small set of packages that match the surface you need. <code>@askdb/core</code> is dialect-agnostic. Postgres-specific behavior lives in <code>@askdb/postgres</code>. Custom enrichment UIs use <code>@askdb/enrich</code>.</p>
          <pre><code>pnpm add @askdb/core @askdb/postgres
# Optional: only for live Postgres introspection
pnpm add pg
# Optional: only for custom Schema v2 enrichment authoring
pnpm add @askdb/enrich
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
      "AskDB is built around schema artifacts, human-reviewed enrichment, validated SQL generation, and explicit safety modes.",
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
          <p><code>@askdb/enrich</code> owns the shared Schema v2 authoring workflow. <code>@askdb/tui</code> and <code>@askdb/studio</code> operate on a Schema v2 directory after introspection; they never open a live database for enrichment, and they save valid <code>tables/&lt;table&gt;.md</code> plus concepts content.</p>
          <pre><code>askdb introspect --url "$DATABASE_URL" --out my-app.schema --schema-id my-app
askdb enrich --schema my-app.schema
askdb bundle my-app.schema --out my-app.schema.bundle.json</code></pre>
        `,
      },
      {
        heading: "Execution Boundary",
        body: `
          <p><code>@askdb/core</code> returns SQL only. Consumers own any later database execution, approval workflow, read-only roles, network policy, and audit logging. Installing <code>pg</code> is not required unless you use live Postgres introspection or pgvector.</p>
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
            <a href="#/core"><strong>@askdb/core</strong><span>Dialect-agnostic library pipeline: schema loading, prompt assembly, generation, validation, and retrieval input.</span></a>
            <a href="#/postgres"><strong>@askdb/postgres</strong><span>Postgres integration package: dialect, catalog connector, templates, bundle reader, and optional <code>pg</code> catalog runner.</span></a>
            <a href="#/introspect"><strong>@askdb/introspect</strong><span>Engine-agnostic introspection orchestrator and Schema v2 renderer.</span></a>
            <a href="#/enrich"><strong>@askdb/enrich</strong><span>Headless Schema v2 enrichment workspace helpers shared by TUI, Studio, and custom authoring UIs.</span></a>
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
          <p>The reusable contracts live in <code>packages/*</code>. The first-party product surfaces live in <code>apps/*</code> or package binaries: CLI, HTTP API, TUI, Studio, and this docs site. UI surfaces depend on shared headless packages instead of each other.</p>
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
      "The core package owns the NL-to-SQL pipeline, Schema v2 loading, enrichment suggestion helpers, logging contracts, and retrieval input. It stays dialect-agnostic and returns SQL only.",
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
            <li><code>ask</code>: generate validated SQL.</li>
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
      "The Postgres package owns everything that is specific to PostgreSQL: the dialect adapter, catalog introspection connector, template bundle, and optional pg-backed catalog query runner.",
    sections: [
      {
        heading: "Install",
        body: `
          <pre><code>pnpm add @askdb/core @askdb/postgres
# only when using live Postgres introspection
pnpm add pg</code></pre>
          <p><code>pg</code> is an optional peer dependency. The package can still provide the dialect, templates, and connector types without forcing a driver into applications that only generate SQL.</p>
        `,
      },
      {
        heading: "What It Provides",
        body: `
          <div class="definition-list">
            <div><code>postgresDialect</code><span>Prompting, SQL generation, and validation rules for read-only Postgres <code>SELECT</code> statements.</span></div>
            <div><code>createPostgresCatalogQueryRunner()</code><span>An introspection-only catalog query runner backed by <code>pg</code>, lazy-loaded when called.</span></div>
            <div><code>createPostgresConnector()</code><span>The connector used by <code>@askdb/introspect</code> for live and from-export catalog reads.</span></div>
            <div><code>POSTGRES_TEMPLATE_BUNDLE</code><span>The catalog SQL suite for air-gapped exports and documented inspection.</span></div>
          </div>
        `,
      },
      {
        heading: "Ask with Postgres",
        body: `
          <pre><code>import { ask, loadSchema } from "@askdb/core";
import { postgresDialect } from "@askdb/postgres";

const schema = loadSchema("./my-app.schema");

const { sql } = await ask({
  question: "How many paid orders were created last month?",
  schema,
  model,
  dialect: postgresDialect,
});</code></pre>
        `,
      },
      {
        heading: "Introspect with Postgres",
        body: `
          <pre><code>import { introspect } from "@askdb/introspect";
import { createPostgresCatalogQueryRunner, createPostgresConnector } from "@askdb/postgres";

await introspect(
  { mode: "live", runner: createPostgresCatalogQueryRunner(process.env.DATABASE_URL!) },
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
      "The CLI ships the `askdb` binary for asking questions, generating SQL, logging, introspection, enrichment, and bundling.",
    sections: [
      {
        heading: "Install",
        body: `
          <pre><code>pnpm add -g @askdb/cli
# or run from a workspace clone
pnpm exec askdb --help</code></pre>
          <p>The CLI is the batteries-included workflow for SQL generation and schema introspection. It uses <code>pg</code> only for live Postgres introspection.</p>
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
import { createPostgresCatalogQueryRunner, createPostgresConnector } from "@askdb/postgres";

await introspect(
  {
    mode: "live",
    runner: createPostgresCatalogQueryRunner(process.env.DATABASE_URL!),
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
    path: "/enrich",
    title: "@askdb/enrich",
    eyebrow: "Headless enrichment",
    description:
      "The enrich package owns reusable Schema v2 authoring workflow logic for TUI, Studio, and custom enrichment UIs.",
    sections: [
      {
        heading: "Install",
        body: `
          <pre><code>pnpm add @askdb/enrich
# usually paired with schema primitives
pnpm add @askdb/core</code></pre>
        `,
      },
      {
        heading: "What It Owns",
        body: `
          <ul>
            <li>Loading a Schema v2 directory as an editable workspace.</li>
            <li>Building table drafts and front-matter from physical schema plus markdown.</li>
            <li>Saving <code>tables/*.md</code> and <code>concepts.md</code>.</li>
            <li>Preserving markdown body sections during scoped edits.</li>
            <li>Building AI suggestion targets and context.</li>
            <li>Bundling a split Schema v2 directory into a single JSON artifact.</li>
          </ul>
        `,
      },
      {
        heading: "Package Boundary",
        body: `
          <p><code>@askdb/enrich</code> depends on <code>@askdb/core</code>. Authoring surfaces such as <code>@askdb/tui</code> and <code>@askdb/studio</code> depend on <code>@askdb/enrich</code>. Studio does not depend on the TUI.</p>
          <pre><code>@askdb/core
   ^
   |
@askdb/enrich
   ^          ^
   |          |
@askdb/tui   @askdb/studio</code></pre>
        `,
      },
      {
        heading: "When to Use It",
        body: `
          <p>Use <code>@askdb/enrich</code> directly when building a custom Schema v2 authoring UI. Use <code>@askdb/tui</code> for the maintained terminal workflow, and <code>@askdb/studio</code> for the maintained local browser workflow.</p>
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
            <li>Press <code>s</code> to write valid Schema v2 markdown through the shared <code>@askdb/enrich</code> workspace helpers.</li>
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
      "The HTTP API exposes a minimal server around @askdb/core. POST /ask returns validated SQL only.",
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
        heading: "Execution Boundary",
        body: `
          <p>Execution is not part of this API. Requests using the retired execution controls receive <code>400</code>; applications run any approved SQL outside AskDB.</p>
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
    path: "/connectors",
    title: "Authoring a Connector",
    eyebrow: "Integration contract",
    description:
      "What a connector needs to plug into @askdb/introspect. The same contract powers @askdb/postgres and @askdb/prisma today and is the path for adding new engines.",
    sections: [
      {
        heading: "The Connector Interface",
        body: `
          <p>A connector is a TypeScript object satisfying <code>Connector&lt;TInput&gt;</code> from <code>@askdb/introspect</code>. <code>describe</code> is required; <code>templates</code> is optional and only relevant when the engine introspects through catalog SQL.</p>
          <pre><code>import type {
  Connector,
  IntrospectionResult,
  SqlTemplateBundle,
} from "@askdb/introspect";

export interface MyConnector extends Connector&lt;MyInput&gt; {
  describe(input: MyInput): Promise&lt;IntrospectionResult&gt;;
  templates?(): SqlTemplateBundle;
}</code></pre>
          <p>The integration package owns <code>MyInput</code>. <code>@askdb/introspect</code> hands it through to <code>describe</code> unchanged.</p>
        `,
      },
      {
        heading: "What describe() Must Return",
        body: `
          <p><code>IntrospectionResult</code> is the whole contract — the orchestrator does not rewrite the schema before rendering Schema v2.</p>
          <pre><code>type IntrospectionResult = {
  schema: SqlSchema;                              // namespaces, tables, columns, FKs, enums, views
  warnings: IntrospectionWarning[];
  isEmpty: boolean;                               // no namespace contains a table
  viewDefinitions: Record&lt;string, string&gt;;    // keyed by "table:&lt;schema&gt;.&lt;view&gt;"
};</code></pre>
        `,
      },
      {
        heading: "Stable IDs",
        body: `
          <p>Every table and column needs an ID that survives re-introspection so enrichment markdown stays attached to the same physical entity.</p>
          <div class="definition-list">
            <div><code>table:&lt;schema&gt;.&lt;name&gt;</code><span>Table ID. In the <code>public</code> schema, Schema v2 accepts the shorter <code>table:&lt;name&gt;</code> form.</span></div>
            <div><code>table:&lt;schema&gt;.&lt;name&gt;#&lt;column&gt;</code><span>Column ID. Use the same format as the reference connectors.</span></div>
          </div>
        `,
      },
      {
        heading: "Filters",
        body: `
          <p><code>IntrospectionFilters</code> is shared across every connector. Honour all three fields.</p>
          <div class="definition-list">
            <div><code>schemas</code><span>Include list. Default to <code>["public"]</code> for relational engines.</span></div>
            <div><code>excludeSchemas</code><span>Additive exclude list. System schemas (<code>information_schema</code>, <code>pg_catalog</code>, <code>pg_toast*</code>, <code>pg_temp_*</code>) are always excluded regardless of this field.</span></div>
            <div><code>tables</code><span>Glob patterns matched against <code>"&lt;schema&gt;.&lt;name&gt;"</code>. Emit an <code>ambiguous_filter</code> warning when a pattern matches nothing.</span></div>
          </div>
        `,
      },
      {
        heading: "Determinism",
        body: `
          <p>Re-introspecting an unchanged source must produce a byte-identical <code>schema.json</code>. That means:</p>
          <ul>
            <li>Sort tables, columns, foreign keys, unique constraints, indexes, and enums by name.</li>
            <li>Preserve the source's declared order for multi-column foreign keys — alphabetising the local or referenced column lists is a bug.</li>
            <li>Preserve enum value order (in Postgres: <code>pg_enum.enumsortorder</code>; in Prisma: declaration order).</li>
            <li>Populate <code>ordinalPosition</code> on every column starting at <code>1</code>.</li>
          </ul>
        `,
      },
      {
        heading: "Warnings, Not Exceptions",
        body: `
          <p>Use <code>IntrospectionWarning</code> for surfaces the user should see but that should not abort the run. Hard failures (missing input, unsupported provider, runner crash) should throw and let the CLI exit non-zero.</p>
          <div class="definition-list">
            <div><code>unsupported_type</code><span>A column type the connector cannot fully represent (e.g. Prisma <code>Unsupported("…")</code>).</span></div>
            <div><code>view_with_array_columns</code><span>A view exposes array columns the renderer cannot fully describe.</span></div>
            <div><code>ambiguous_filter</code><span>A <code>tables</code> glob matched no rows.</span></div>
            <div><code>new_column</code><span>Render-time: a new column ID appeared since the previous run.</span></div>
            <div><code>orphan_id</code><span>Render-time: an ID referenced by table markdown is gone from the source.</span></div>
          </div>
        `,
      },
      {
        heading: "templates() — Catalog SQL Only",
        body: `
          <p>Implement <code>templates()</code> when the engine reads its schema through catalog SQL. The bundle is what <code>askdb introspect templates --engine &lt;id&gt;</code> prints and what the air-gapped <code>--from-export</code> path consumes.</p>
          <pre><code>type SqlTemplateBundle = {
  engine: string;            // e.g. "postgres"
  version: number;           // bump when any template's shape changes
  templates: readonly SqlTemplate[];
};

type SqlTemplate = {
  name: string;              // stable; maps to a CSV/JSON file in an export bundle
  sql: string;               // parameterized; bound by the connector at run time
  columns: readonly string[]; // declared columns — used to validate CSV headers
};</code></pre>
          <p>File-driven connectors (Prisma) legitimately omit <code>templates()</code>; <code>@askdb/introspect</code> checks for its presence before calling.</p>
        `,
      },
      {
        heading: "Input Shape",
        body: `
          <p>Each integration exports the input type it actually needs — there is no shared discriminated union. Choose the shape that's honest for the source.</p>
          <pre><code>// @askdb/postgres
type PostgresIntrospectionInput =
  | { mode: "live"; runner: CatalogQueryRunner; filters?: IntrospectionFilters }
  | { mode: "from-export"; bundlePath: string; filters?: IntrospectionFilters };

// @askdb/prisma
type PrismaIntrospectionInput = {
  schemaPath: string;        // .prisma file or directory of .prisma files
  schemaId?: string;
  filters?: IntrospectionFilters;
};</code></pre>
        `,
      },
      {
        heading: "Live Mode — CatalogQueryRunner",
        body: `
          <p>For database-backed connectors, expose a runner factory rather than baking in a driver. The runner is introspection-only; generated user SQL never flows through it.</p>
          <pre><code>type CatalogQueryResult = { columns: string[]; rows: unknown[][] };
type CatalogQueryRunner = (
  sql: string,
  params?: ReadonlyArray&lt;unknown&gt;,
) =&gt; Promise&lt;CatalogQueryResult&gt;;</code></pre>
          <ul>
            <li>Drivers are optional peer dependencies — <code>@askdb/postgres</code> lazy-loads <code>pg</code> inside the factory so callers that only generate SQL never pull the driver in.</li>
            <li>Export the runner type so tests and alternative drivers (e.g. <code>postgres.js</code>, Neon HTTP) can plug in.</li>
          </ul>
        `,
      },
      {
        heading: "Optional: AskDialect",
        body: `
          <p>Introspection and SQL generation are separate seams. A connector covers introspection; SQL generation goes through an <code>AskDialect</code> adapter consumed by <code>ask()</code> in <code>@askdb/core</code>.</p>
          <pre><code>import type { AskDialect } from "@askdb/core";

export const myDialect: AskDialect = {
  async generate(question, schema, model, options) {
    // build a prompt, call the model, validate the SELECT
  },
};</code></pre>
          <p>Ship a dialect when the target has a distinct SQL surface (a new engine, different read-only rules, a different prompt body). Skip it when your connector simply produces Schema v2 for an engine that already has one — <code>@askdb/prisma</code> is the canonical example.</p>
        `,
      },
      {
        heading: "Package Layout",
        body: `
          <pre><code>packages/&lt;name&gt;/
  package.json          # name "@askdb/&lt;name&gt;", "type": "module"
  README.md
  LICENSE
  NOTICE
  tsconfig.json
  tsconfig.build.json
  src/
    index.ts            # public exports
    &lt;connector&gt;.ts      # createXConnector(), describeX()</code></pre>
          <p>Expected exports:</p>
          <ul>
            <li><code>createXConnector(): Connector&lt;XInput&gt;</code> — the factory the CLI and library callers wire up.</li>
            <li><code>describeX(input: XInput)</code> — the bare function for tests and bespoke pipelines.</li>
            <li>The input type (<code>XIntrospectionInput</code>).</li>
            <li>(Optional) a dialect, template bundle constants, and runner factory.</li>
          </ul>
          <p>Wire the engine into <code>apps/cli/src/introspect.ts</code> behind <code>--engine</code> and add the package to <a href="#/packages">Packages</a> and the installable-package guide.</p>
        `,
      },
      {
        heading: "Testing Checklist",
        body: `
          <ul>
            <li><strong>Unit:</strong> representative source → expected <code>SqlSchema</code>, including filters, ordering, and warnings.</li>
            <li><strong>Filters:</strong> <code>schemas</code>, <code>excludeSchemas</code>, <code>tables</code> globs, the system-schema guarantee, and <code>ambiguous_filter</code> emission.</li>
            <li><strong>Determinism:</strong> re-running on unchanged input produces byte-identical <code>schema.json</code>.</li>
            <li><strong>Re-introspection:</strong> through <code>introspect()</code> with an existing output dir, IDs are preserved, additions emit <code>new_column</code>, removals emit <code>orphan_id</code>.</li>
            <li><strong>Integration:</strong> for a live runner, hit a real instance (e.g. Pagila for Postgres) and snapshot. For file readers, commit fixture inputs next to the snapshot.</li>
          </ul>
        `,
      },
      {
        heading: "Reference Connectors",
        body: `
          <div class="link-cards">
            <a href="#/postgres"><strong>@askdb/postgres</strong><span>Live + air-gapped modes, full template bundle, <code>pg</code>-backed catalog runner, and <code>postgresDialect</code>.</span></a>
            <a href="#/packages"><strong>@askdb/prisma</strong><span>File-only input, no <code>templates()</code>, no dialect. Pair with <code>postgresDialect</code> for SQL generation.</span></a>
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
          <p>The default mode. AskDB grounds generation in schema context and returns SQL only.</p>
          <pre><code>askdb ask \\
  --schema my-app.schema \\
  --question "How many orders?" \\
  --mode schema_only</code></pre>
        `,
      },
      {
        heading: "bounded_results",
        body: `
          <p>Reserved for future workflows where a host application may summarize bounded tabular results. Current AskDB surfaces still return SQL only.</p>
          <pre><code>askdb ask \\
  --schema my-app.schema \\
  --question "Show recent signups" \\
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
            <div><code>DATABASE_URL</code><span>Required only for live Postgres introspection.</span></div>
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
const themeToggle = document.querySelector("[data-theme-toggle]");

const THEME_STORAGE_KEY = "askdb-docs-theme";
const prefersDark = window.matchMedia("(prefers-color-scheme: dark)");

function getStoredTheme() {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch (error) {
    return null;
  }
}

function getActiveTheme() {
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

function applyTheme(theme, persist) {
  const next = theme === "dark" ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", next);
  if (themeToggle) {
    const label = next === "dark" ? "Switch to light theme" : "Switch to dark theme";
    themeToggle.setAttribute("aria-label", label);
    themeToggle.setAttribute("title", label);
  }
  if (persist) {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch (error) {
      // Storage may be unavailable (private mode, etc.) — theme still applies for the session.
    }
  }
}

applyTheme(getActiveTheme(), false);

if (prefersDark.addEventListener) {
  prefersDark.addEventListener("change", (event) => {
    if (!getStoredTheme()) {
      applyTheme(event.matches ? "dark" : "light", false);
    }
  });
}

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
themeToggle?.addEventListener("click", () => {
  applyTheme(getActiveTheme() === "dark" ? "light" : "dark", true);
});
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
