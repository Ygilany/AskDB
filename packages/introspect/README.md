# @askdb/introspect

Postgres schema introspection for AskDB. It turns catalog metadata into a Schema v2 directory that `@askdb/core` can load and that Phase 7 enrichment can describe.

> Status: pre-1.0. Phase 6 ships Postgres first through a connector seam; additional engines can use the same `Connector` contract later.

## Install

```bash
pnpm add @askdb/introspect @askdb/core
# only for live Postgres mode using the built-in executor:
pnpm add pg
```

`@askdb/introspect` itself does not import `pg`. Live mode accepts an `AskDbExecutor`; the built-in `pg` executor comes from `@askdb/core/postgres`.

## Live Mode

```bash
export DATABASE_URL=postgres://user:pass@host:5432/db

askdb-introspect \
  --url "$DATABASE_URL" \
  --out my-app.schema \
  --schema-id my-app
```

The output directory contains a physical Schema v2 artifact:

```text
my-app.schema/
  schema.json
```

That directory is valid immediately:

```ts
import { loadSchema } from "@askdb/core";

const schema = loadSchema("./my-app.schema");
```

## Air-Gapped Mode

Use this when AskDB should not open a network connection to the database.

First print the canonical Postgres catalog SQL:

```bash
askdb-introspect templates --engine postgres > pg-introspection.sql
```

Run each template query in your own database tool and save one result file per template in a bundle directory. CSV and JSON are both accepted.

```text
pg-export/
  manifest.json
  schemas.csv
  tables.csv
  columns.csv
  primary_keys.csv
  foreign_keys.csv
  unique_constraints.csv
  check_constraints.csv
  indexes.csv
  enums.csv
  sequences.csv
  views.csv
  comments.csv
```

Minimal `manifest.json`:

```json
{
  "engine": "postgres",
  "version": 1
}
```

Then render the bundle without connecting to the database:

```bash
askdb-introspect \
  --from-export ./pg-export \
  --out my-app.schema \
  --schema-id my-app
```

## CLI Surface

```bash
# Live
askdb-introspect --url "$DATABASE_URL" --out my-app.schema --schema-id my-app

# Air-gapped
askdb-introspect --from-export ./pg-export --out my-app.schema --schema-id my-app

# Print Schema v2 JSON to stdout
askdb-introspect --from-export ./pg-export --print --schema-id my-app

# Compare generated schema.json with an existing directory without writing
askdb-introspect --from-export ./pg-export --diff my-app.schema --schema-id my-app

# Same runner through @askdb/cli
askdb introspect --from-export ./pg-export --out my-app.schema --schema-id my-app
```

Useful filters:

```bash
askdb-introspect \
  --url "$DATABASE_URL" \
  --out my-app.schema \
  --schemas public,app \
  --exclude-schemas audit \
  --tables 'public.users,app.orders*'
```

Structured logs use `askdb.introspect.*` events:

```bash
askdb-introspect \
  --from-export ./pg-export \
  --out my-app.schema \
  --log-file ./logs/introspect.jsonl \
  --correlation-id deploy-2026-05-10
```

## Library API

```ts
import { introspect } from "@askdb/introspect";
import { createPostgresExecutor } from "@askdb/core/postgres";

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
);
```

Air-gapped library use:

```ts
import { introspect } from "@askdb/introspect";

await introspect(
  { mode: "from-export", bundlePath: "./pg-export" },
  { outDir: "my-app.schema", schemaId: "my-app" },
);
```

Direct connector access:

```ts
import { createPostgresConnector } from "@askdb/introspect/postgres";

const connector = createPostgresConnector();
const templates = connector.templates();
```

## Re-Introspection

Re-running with the same `--out` directory performs an ID-anchored merge:

- Existing table and column IDs are preserved.
- Existing physical `sensitive` flags in `schema.json` are preserved.
- New columns emit `new_column` warnings.
- Removed IDs referenced by `tables/*.md` emit `orphan_id` warnings.
- Only `schema.json` is written. `tables/*.md` and `concepts.md` are read for warnings and never modified.

This keeps the physical layer current while preserving the describable layer for enrichment.

## Output Contract

The renderer writes Schema v2, documented in [`docs/contracts/schema-v2.md`](../../docs/contracts/schema-v2.md). A fresh introspection writes physical metadata only; descriptions, aliases, examples, and concepts are added later by enrichment tooling or by hand.

## License

Apache-2.0. See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
