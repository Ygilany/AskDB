# AskDB Docs Editorial Review

## Overall assessment

The current AskDB documentation is strong technically, but it reads more like internal architecture documentation than a public-facing explanation of what AskDB is. A first-time visitor has to already understand terms like Schema v2, describable schema, trust-first analytics, BYO runtime, RAG, bounded results, and execution boundary before they can fully understand the homepage.

The site already has the right foundation: AskDB turns natural language into schema-grounded SQL and reports, with support for library, CLI, and HTTP usage. It also emphasizes schema-grounded generation, human-reviewed enrichment, SQL validation, and the fact that AskDB returns SQL instead of directly executing it.

The main editorial change is to bring those ideas forward in plain language before introducing package architecture.

## Main positioning change ✅

Current homepage lead:

> AskDB turns natural language into schema-grounded SQL and reports. anchored in your describable schema, with explicit boundaries when data touches a model. Ship it as a library, CLI, or HTTP surface you control.

Recommended replacement:

> **AskDB helps developers add natural-language analytics to their own applications.**
>
> It turns user questions into validated SQL using a schema that your team can inspect, enrich, and control. AskDB does not require you to hand over database execution to an AI system. It generates SQL, explains the schema context behind it, and lets your application decide how that SQL is reviewed, approved, and run.

This makes the “what is this?” easier to understand before the reader gets into architecture.

## Homepage rewrite ✅

> **Note:** The `## First run` section within this rewrite was already present in `index.mdx` before these edits and was preserved unchanged — it matched the recommended content.

```md
# AskDB Documentation

AskDB helps developers add natural-language analytics to their own applications.

It turns user questions into validated SQL using a schema that your team can inspect, enrich, and control. AskDB does not take over your database. It generates SQL from trusted schema context, validates the query, and leaves execution, approval, permissions, and audit logging in your application.

[Quickstart] [Journeys]

## What AskDB is

AskDB is a developer toolkit for building “ask your data” experiences.

You can use it to:

- generate SQL from natural-language questions
- create a reviewed schema artifact from Postgres or Prisma
- enrich tables and columns with human-approved descriptions, aliases, and business concepts
- add retrieval when a schema is too large for one prompt
- expose the same engine through a library, CLI, or HTTP API

## The core idea

AskDB is built around a simple trust model:

1. Your database schema is turned into an AskDB schema artifact.
2. Humans can enrich that schema with descriptions, aliases, and business meaning.
3. AskDB uses that schema context to generate SQL.
4. AskDB validates the generated SQL.
5. Your application decides whether and how to run it.

This keeps the AI close to the schema, but keeps database execution under your control.

## Who AskDB is for

### Application developers

Use AskDB when you want to embed natural-language analytics into a product, dashboard, internal tool, or service.

### Data and schema owners

Use AskDB when you want the AI to understand your schema the way your team understands it, not just as raw table and column names.

### Platform and agent builders

Use AskDB when you need stable contracts for CLI workflows, HTTP services, automation, or future agent integrations.

## What AskDB gives you

### Schema-grounded SQL generation

AskDB generates SQL from a reviewed schema artifact instead of relying only on raw database metadata.

### Human-reviewed schema enrichment

Add descriptions, aliases, concepts, and example language so generated SQL reflects how your team talks about the data.

### Clear execution boundaries

AskDB returns validated SQL. Your application owns database execution, approval workflows, read-only roles, tenant policy, network controls, and audit logging.

### Bring-your-own runtime

Use your own model provider, database connection, embeddings, and vector store. Install only the packages your integration needs.

### Retrieval-ready schema context

For large schemas, AskDB can chunk and retrieve from the same schema artifact. You do not need to maintain a separate knowledge base that can drift away from the schema.

## Choose a path

- **Start quickly:** install the CLI, create a schema, and ask your first question.
- **Embed AskDB:** call `ask()` from a Node application.
- **Author schema context:** introspect, enrich, and bundle a schema artifact.
- **Add retrieval:** index large schemas for focused context.
- **Expose an API:** run the HTTP surface behind your own auth and policies.
- **Understand the architecture:** review package boundaries and extension points.

## First run

Install dependencies, create a schema artifact, optionally enrich it, then ask a question.

```bash
npm install askdb

npx askdb init

npx askdb introspect \
  --url "$DATABASE_URL" \
  --out my-app.schema \
  --schema-id my-app

npx askdb enrich --schema my-app.schema

npx askdb ask \
  --schema my-app.schema \
  --question "Which tables are connected to users?"
```

## Documentation map

- **Quickstart:** local setup, schema creation, and your first question.
- **Journeys:** task-based paths for embedding, enrichment, retrieval, HTTP, and agent workflows.
- **Core concepts:** pipeline, schema artifacts, enrichment, validation, and execution boundaries.
- **Architecture:** package layers, dependency direction, connectors, and extension points.
- **Package reference:** what each `@askdb/*` package owns.
- **Modes and safety:** model context boundaries, SQL validation, and sensitive field handling.
```

## Important editorial fixes

### 1. ✅ Define “trust-first analytics” before using it

The homepage and Journeys page both use “trust-first analytics” early. Avoid leading with the phrase until it is defined.

Use this:

```md
## Trust-first analytics

AskDB is designed for analytics workflows where users need to trust the generated SQL before acting on it.

That means AskDB makes the schema context explicit, validates generated SQL, treats row-level data as sensitive by default, and leaves execution decisions to the host application.
```

Then later, you can safely say:

```md
This is what we mean by trust-first analytics: answers should be grounded, inspectable, and controlled by the application that uses them.
```

### 2. ✅ Replace “describable schema” with “schema artifact”

“Describable schema” is meaningful internally, but not obvious to a new reader. Use **schema artifact** as the default public term, then explain that it can include descriptions.

Current:

> anchored in your describable schema

Better:

> grounded in a schema artifact your team can review and enrich

### 3. ✅ Make the execution boundary more concrete

The docs correctly say `@askdb/core` returns SQL and the host owns execution. That is one of the strongest product differentiators. Repeat it more plainly on the homepage and Quickstart.

Suggested wording:

```md
AskDB does not silently run generated SQL against your database. It returns validated SQL. Your application decides whether to show it, review it, approve it, modify it, run it, log it, or reject it.
```

### 4. ✅ Rename “Who you are” to “Who AskDB is for”

“Who you are” sounds abstract. “Who AskDB is for” is clearer and more conventional for docs.

Recommended roles:

```md
### Application developer
You want to embed natural-language analytics into an app, dashboard, or internal tool.

### Schema author
You want to turn raw database structure into reviewed schema context that reflects how your team talks about the data.

### Platform or agent builder
You want stable contracts for CLI, HTTP, automation, or future agent integrations.
```

### 5. ✅ Fix or remove the broken Schema v2 link

The homepage documentation map links to **Schema v2**, but the fetched link returned a 404 at `/AskDB/schema-v2/`. The sidebar appears to call the same concept **AskDB schema** in some places and **Schema v2** in others. Pick one public label.

Recommendation:

- Public page title: **AskDB schema**
- Technical term inside page: **Schema v2**

Example:

```md
# AskDB schema

An AskDB schema is the portable artifact AskDB uses to understand your database. The current format is Schema v2.
```

### 6. ✅ Make Quickstart less split-brained

The Quickstart currently has “Option A” for repo contributors and “Option B” for npm install. That is useful, but the typical user path should come first.

Recommended structure:

```md
## Typical install

Use this path when you are adding AskDB to your own project.

...

## Working from the AskDB repository

Use this path when you are contributing to AskDB itself.
```

That small change makes the page feel like product documentation first, contributor documentation second.

### 7. ✅ Simplify the Journeys intro

Current:

> AskDB optimizes for trust-first analytics ... and a developer-first embed ... Choose the journey that matches what you are shipping. not the package name you might install first.

Suggested:

```md
# Journeys

Choose the path that matches what you are trying to build.

AskDB is split into packages, but most users should not start with package names. Start with the outcome: embed natural-language SQL, author schema context, add retrieval, expose an HTTP API, or prepare for agent workflows.
```

### 8. ✅ Tighten package-heavy sections

The Architecture and Package Reference pages are useful, but they are dense. The Package Reference page currently lists many packages in one compressed section. Turn that into a table or grouped list.

```md
## Core runtime

| Package | Use it when |
| --- | --- |
| `@askdb/core` | You want schema loading, prompt assembly, SQL generation, and validation. |
| `@askdb/postgres` | You need Postgres SQL generation, validation, or catalog introspection. |

## Schema authoring

| Package | Use it when |
| --- | --- |
| `@askdb/introspect` | You want to create an AskDB schema from a database or schema source. |
| `@askdb/enrich` | You are building or extending a schema authoring workflow. |
| `@askdb/tui` | You want terminal-based schema enrichment. |
| `@askdb/studio` | You want browser-based schema enrichment. |

## Retrieval

| Package | Use it when |
| --- | --- |
| `@askdb/rag` | Your schema is too large to send in every prompt and you need focused schema retrieval. |

## Surfaces

| Package | Use it when |
| --- | --- |
| `askdb` | You want the CLI. |
| `@askdb/http-api` | You want to expose AskDB through HTTP behind your own auth and policy layer. |
```

## Editorial style guide for the AskDB docs

### Prefer

- “schema artifact” over “describable schema”
- “reviewed schema context” over “describable context”
- “natural-language analytics” over “NL-to-SQL” in introductory sections
- “AskDB returns SQL” over “execution boundary” in beginner-facing sections
- “your application owns execution” over “host owns execution”
- “large schemas” over “RAG” until the concept is introduced

### Avoid using too early

- Schema v2
- RAG
- BYO runtime
- MCP
- bounded results
- headless contracts
- dialect-agnostic
- optional peers
- runtime snapshot

Those terms are fine in architecture and reference pages, but they should come after the reader understands the product.

## Recommended public-facing description ✅

Use this across the README, docs homepage, npm package, and GitHub repo description:

> **AskDB is a developer toolkit for adding natural-language analytics to your application. It turns user questions into validated SQL using schema context your team can review, enrich, and control.**

A slightly more technical version:

> **AskDB turns natural-language questions into validated SQL using a human-enriched schema artifact. It gives developers library, CLI, and HTTP surfaces while keeping database execution, permissions, and audit logging inside the host application.**

Concise tagline:

> **Ask your data. Keep control of the query.**


## Recommendation: Replace “Pick your lane” with a progressive workflow ✅

The “Pick your lane” section is probably more confusing than valuable on the homepage.

The reason is that the lanes sound like they represent different workflows, but the actual workflow is mostly the same for everyone.

The real difference is not:

> “Which kind of user are you?”

It is more like:

> “How far do you want to take AskDB?”

That suggests the homepage should present AskDB as a progressive workflow, not as a set of personas.

## Why “Pick your lane” may confuse users

The current framing risks making users wonder:

- “Am I an integrator or schema author?”
- “Do I need to choose the right path before I start?”
- “Are these separate products or modes?”
- “Will I miss something if I choose the wrong lane?”

For a developer library, that creates unnecessary cognitive load. Most developers want to know:

1. How do I install it?
2. How do I connect my database?
3. How do I connect my model?
4. How do I generate a schema?
5. How do I ask questions?
6. How do I make results better?
7. How do I scale this when the schema gets large?
8. How do I embed this into my app?

That is a much clearer flow.

## Better framing

Instead of “Pick your lane,” use something like:

### Start simple, then add what you need

AskDB follows the same core workflow whether you use it from the CLI, a Node library, or an HTTP API.

1. **Initialize AskDB**  
   Create the project configuration and choose how AskDB will run in your environment.

2. **Connect your runtime**  
   Configure your database, AI model, embedding provider, and vector store.

3. **Introspect your database**  
   Generate an AskDB schema artifact from your database structure.

4. **Ask your first questions**  
   Test natural-language questions and inspect the SQL AskDB generates.

5. **Enrich the schema**  
   Add business context, aliases, descriptions, and common query patterns through Studio or the TUI.

6. **Add retrieval when needed**  
   Index the schema artifact so AskDB can retrieve only the most relevant schema context for large databases.

7. **Embed AskDB in your application**  
   Use the library or HTTP API to add natural-language analytics to your own product, dashboard, or internal tool.

This makes the product feel easier to approach because everyone starts in the same place.

## Where personas still help

Do not delete the persona idea entirely. Move it lower or make it secondary.

Personas are useful for explaining why someone cares, not how they start.

For example:

```md
## Who benefits from this workflow?

### Application developers
Use AskDB to add natural-language analytics to an app, dashboard, or internal tool.

### Data and product teams
Use AskDB to encode business meaning into the schema so answers match how your team talks about the data.

### Platform teams
Use AskDB to expose a controlled SQL-generation layer behind your own auth, permissions, logging, and approval workflows.
```

That is helpful because it explains value, but it does not imply separate onboarding paths.

## Recommended homepage replacement

Replace “Pick your lane” with this:

```md
## How AskDB works

AskDB uses the same core workflow whether you use the CLI, the Node library, or the HTTP API.

1. **Initialize AskDB**  
   Set up AskDB for your project.

2. **Configure your runtime**  
   Connect your database, AI model, embedding provider, and vector store.

3. **Create a schema artifact**  
   Introspect your database so AskDB has a structured view of your tables, columns, relationships, and constraints.

4. **Ask questions**  
   Test natural-language questions and inspect the SQL AskDB generates.

5. **Enrich the schema**  
   Add descriptions, aliases, business concepts, and common query patterns using Studio or the TUI.

6. **Add retrieval for large schemas**  
   Index the schema artifact so AskDB can retrieve the most relevant context instead of sending the entire schema every time.

7. **Embed AskDB where you need it**  
   Use AskDB through the CLI, Node library, or HTTP API depending on how you want to integrate it.
```

Then follow it with:

```md
## Use AskDB as much or as little as you need

Start with SQL generation from an introspected schema. Add schema enrichment when you need more business context. Add retrieval when your schema is too large for a single prompt. Expose AskDB through HTTP when you want to put it behind your own authentication, permissions, logging, and approval flow.
```

## Strongest recommendation

The homepage should guide people through the product mental model, not the package structure and not the persona split.

Change:

> Pick your lane

To one of these:

> How AskDB works

Or:

> Start simple, then add what you need

That better matches the product. AskDB is not three different lanes. It is one workflow with optional layers.

