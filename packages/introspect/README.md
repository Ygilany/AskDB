# `@askdb/introspect`

Engine-agnostic introspection orchestrator for AskDB. Defines the `Connector` contract and turns the integration package's `SqlSchema` output into a Schema v2 directory.

> Status: pre-1.0. `@askdb/introspect` itself does not bundle any engine support — integration packages (e.g. `@askdb/postgres`) supply connectors and input shapes.

## Install

```bash
pnpm add @askdb/introspect @askdb/core
# Plus an integration package for the engine you're targeting, e.g.:
pnpm add @askdb/postgres pg
```

## Programmatic usage

```ts
import { introspect } from "@askdb/introspect";
import { createPostgresConnector, createPostgresExecutor } from "@askdb/postgres";

const result = await introspect(
  { mode: "live", executor: createPostgresExecutor(process.env.DATABASE_URL!) },
  { outDir: "./my-app.schema", schemaId: "my-app" },
  { connector: createPostgresConnector() },
);
```

The output directory contains a physical Schema v2 artifact (`schema.json`) plus the Phase 5 describable layer.

## CLI

The user-facing CLI for introspection ships in `@askdb/cli` as `askdb introspect`. `@askdb/introspect` does not provide a standalone binary.

## Implementing a new connector

A `Connector<TInput>` has two methods:

- `describe(input: TInput): Promise<IntrospectionResult>` — the integration's input shape goes through unchanged.
- `templates?(): SqlTemplateBundle` — optional; only relevant for engines that introspect via catalog SQL.

The integration package owns its own input type (e.g. `PostgresIntrospectionInput`). `@askdb/introspect` does not assume an executor exists, a bundle path exists, or a template suite exists.
