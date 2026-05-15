# Phase 6 — Schema introspection (`@askdb/introspect`) (requirements)

Status: Not reviewed

See also **[`plan.md`](./plan.md)** (milestones) and **[`validation.md`](./validation.md)** (merge bar).

## Context

The mission frames AskDB as **schema-first** with **flexible connectivity**: teams either import schema artifacts and never expose credentials, or attach a live connection on their infrastructure when execution / sync is desired ([`docs/mission.md`](../../mission.md)). For the schema-first path to work in practice, AskDB needs a **first-class introspector** — something that turns a real database into a Schema v2 physical artifact users can then enrich (Phase 7), embed (Phase 8), or hand-edit.

Phase 5 ships the Schema v2 reader/writer in `@askdb/core`. Phase 6 ships **`@askdb/introspect`** — the package that produces those v2 directories. The design is informed by deep reading of how Drizzle and Prisma do this:

- **Prisma's `schema-engine`** uses a **Core/Connector pattern** — database-agnostic core orchestration plus per-engine connectors (Postgres, MySQL, SQLite, MSSQL, MongoDB). Returns an `IntrospectionResult` with `schema`, `warnings`, `isEmpty`, and `viewDefinitions`. **Re-introspection preserves manual edits** (e.g. `@map`/`@@map` renames) by reading the existing schema and re-applying the user's customizations.
- **Drizzle's `pgSerializer.fromDatabase`** uses primarily `pg_catalog` (richer types, FK column ordering) plus `information_schema` joins; pragmatic per-dialect catalog SQL with documented ordering pitfalls (multi-column FK column order, enum value order, deterministic ordering of all results).

Phase 6 takes the **best of each**: Prisma's connector pattern + `IntrospectionResult` shape + re-introspection preservation contract; Drizzle's pragmatic catalog SQL + deterministic-by-construction queries.

## Problem

Without Phase 6:

- The only way to produce a Schema v2 artifact is hand-authoring `schema.json` from scratch — fine for a 5-table demo, untenable at real-schema scale.
- Phase 7's TUI has nothing to open as the canonical first-run flow; "give me a markdown directory" is a hostile entry point compared to "point me at your DB".
- Phase 8's RAG layer has nothing to chunk for real-world consumers, since they need a v2 directory before they can index it.
- The mission's promise of "no credentials inside AskDB" is hollow without a documented, tested path that ingests metadata from outside (the air-gapped path).

## Scope (in)

### 1) `@askdb/introspect` package

A new workspace package: `packages/introspect/`, published as `@askdb/introspect`, exporting a small public surface focused on three things — describe (run a connector against an input), render (turn the intermediate `SqlSchema` into a v2 directory), and merge (preserve IDs from a previous run).

**Sub-exports:**

- `@askdb/introspect` — public types (`SqlSchema`, `IntrospectionInput`, `IntrospectionResult`, `Connector`), `introspect()` entry point, and the renderer.
- `@askdb/introspect/postgres` — the Postgres connector. Phase 6 ships this only; the seam is the entry point for additional engines in Phase 11.

**Binary:** `bin: { "askdb-introspect": "./dist/bin.js" }`. CLI is also available as `askdb introspect` via a thin shim in `askdb`.

### 2) Connector contract

```ts
export type SqlSchema = {
  schemaId: string;
  schemas: Array<{
    name: string;
    tables: SqlTable[];
    views: SqlView[];
    enums: SqlEnum[];
    sequences: SqlSequence[];
  }>;
};

export type SqlTable = {
  id: string;                       // "table:<schema>.<name>" (or "table:<name>" in public)
  schema: string;
  name: string;
  comment?: string;                 // pg_description-derived; surfaced as informational only
  columns: SqlColumn[];
  primaryKey?: { columns: string[] };
  foreignKeys: SqlForeignKey[];     // ordered by constraint name; column lists preserve conkey order
  uniqueConstraints: SqlUnique[];
  indexes: SqlIndex[];
  // Captured but not yet emitted into Schema v2:
  checkConstraints: SqlCheck[];
  rowLevelSecurity?: { enabled: boolean };
};

export type SqlColumn = {
  id: string;                       // "table:<schema>.<name>#<col>"
  name: string;
  ordinalPosition: number;
  dataType: string;                 // canonical Postgres type string (e.g. "uuid", "text", "numeric(10,2)", "timestamp with time zone")
  udtName: string;                  // raw udt_name for arrays / enums
  nullable: boolean;
  primaryKey: boolean;
  defaultExpression?: string;
  comment?: string;
};

export type SqlForeignKey = {
  name: string;
  columns: string[];                // preserves pg_constraint.conkey order — multi-column FK fix
  references: { schema: string; table: string; columns: string[] };  // confkey order
  onDelete?: "no action" | "restrict" | "cascade" | "set null" | "set default";
  onUpdate?: "no action" | "restrict" | "cascade" | "set null" | "set default";
};

export type SqlEnum = {
  schema: string;
  name: string;
  values: string[];                 // preserves pg_enum.enumsortorder
};

export type SqlView = {
  schema: string;
  name: string;
  definition: string;
  columns: SqlColumn[];
};

export type IntrospectionFilters = {
  schemas?: string[];               // include-list; default ["public"]
  excludeSchemas?: string[];        // always excludes information_schema, pg_catalog, pg_toast*, pg_temp_*
  tables?: string[];                // glob patterns; matches against "<schema>.<name>"
};

export type IntrospectionInput =
  | { mode: "live"; executor: AskDbExecutor; filters?: IntrospectionFilters }
  | { mode: "from-export"; bundlePath: string; filters?: IntrospectionFilters };

export type IntrospectionWarning =
  | { code: "orphan_id"; id: string; file: string }
  | { code: "new_column"; id: string; tableId: string }
  | { code: "unsupported_type"; column: string; type: string }
  | { code: "view_with_array_columns"; view: string; columns: string[] }
  | { code: "ambiguous_filter"; filter: string };

export type IntrospectionResult = {
  schema: SqlSchema;
  warnings: IntrospectionWarning[];
  isEmpty: boolean;
  viewDefinitions: Record<string, string>;  // keyed by "table:<schema>.<view>"
};

export interface Connector {
  readonly engine: "postgres";
  describe(input: IntrospectionInput): Promise<IntrospectionResult>;
  /** SQL templates for the air-gapped path; see "Two front doors" below. */
  templates(): SqlTemplateBundle;
}
```

Both modes — `live` and `from-export` — go through the **same connector** and produce the **same** `IntrospectionResult`. The difference is purely how the catalog rows arrive: via `executor.run(sql, params)` or via files on disk.

### 3) Two front doors, one connector

**Live mode** — `introspect({ mode: "live", executor, filters })`:

- Reuses Phase 4's `AskDbExecutor` seam. The executor must be **read-only** (the connector does not assume otherwise; it only runs `SELECT`s).
- Runs the connector's catalog SQL suite directly against the live database.
- Suitable for dev workflows, CI introspection of a transient DB, or any environment where AskDB is allowed to connect.

**Air-gapped mode** — `introspect({ mode: "from-export", bundlePath, filters })`:

- The bundle is a directory (or zip) on disk produced by running the connector's `templates()` SQL outside AskDB (in `psql`, an IDE, a CI job). Each template has a stable name; the bundle has one file per template (CSV or JSON; both supported).
- AskDB never opens a connection. Suitable for environments where AskDB cannot or should not reach the database directly (locked-down VPCs, regulated production, separation-of-duties policies).
- The connector's `describe()` reads the bundle's CSV/JSON exactly as if it had run the queries itself, then merges the rows into the same `SqlSchema`.

The CLI exposes both:

```sh
# Live
askdb introspect --url postgres://user:pass@host:5432/db --out my-app.schema/

# Air-gapped
askdb introspect --from-export ./pg-export-bundle/ --out my-app.schema/

# Print bundled SQL templates (for the air-gapped path)
askdb introspect templates --engine postgres > pg-templates.sql

# Diff against an existing artifact (no writes)
askdb introspect --url postgres://... --diff my-app.schema/
```

### 4) Postgres connector — catalog SQL suite

The Postgres connector queries `pg_catalog` for accuracy and `information_schema` for human-friendly type strings. **Every query includes an explicit `ORDER BY`** so re-runs are byte-identical. The query suite (each is one of `templates()`):

| Template | Source | Purpose |
|---|---|---|
| `schemas` | `pg_catalog.pg_namespace` | List namespaces (excluding system + temp). |
| `tables` | `pg_catalog.pg_class` + `pg_namespace` | Tables (`relkind='r'`), views (`'v'`), materialized views (`'m'`); RLS flag from `relrowsecurity`. |
| `columns` | `pg_catalog.pg_attribute` + `pg_type` + `information_schema.columns` | Per-table columns: name, type (formatted via `format_type(atttypid, atttypmod)`), `udt_name`, nullable, default, comment from `pg_description`. |
| `primary_keys` | `pg_catalog.pg_constraint` (`contype='p'`) + `pg_attribute` | PK column names per table, ordered by `pg_constraint.conkey` position. |
| `foreign_keys` | `pg_catalog.pg_constraint` (`contype='f'`) + `pg_attribute` | FKs with **`conkey`-ordered local columns** and **`confkey`-ordered referenced columns** (regression guard for the documented Drizzle multi-column-FK ordering bug). Includes `confdeltype`/`confupdtype`. |
| `unique_constraints` | `pg_catalog.pg_constraint` (`contype='u'`) + `pg_attribute` | Unique constraints with column ordering. |
| `check_constraints` | `pg_catalog.pg_constraint` (`contype='c'`) | Captured for `SqlSchema` completeness; not emitted into Schema v2 in this phase. |
| `indexes` | `pg_catalog.pg_index` + `pg_class` + `pg_am` + `pg_attribute` | Index name, columns, expressions, uniqueness, AM type. |
| `enums` | `pg_catalog.pg_type` + `pg_enum` | Enums with values **ordered by `pg_enum.enumsortorder`**. |
| `sequences` | `pg_sequences` | Sequence metadata. |
| `views` | `pg_catalog.pg_views` | View definitions for `viewDefinitions`. |
| `comments` | `pg_catalog.pg_description` | Object/column comments. |

Each query filters out `information_schema`, `pg_catalog`, `pg_toast*`, `pg_temp_*`, and applies `IntrospectionFilters` consistently.

The reference SQL from [`docs/specs/postgres-introspection-for-askdb-schema-v1.md`](../postgres-introspection-for-askdb-schema-v1.md) is the starting point; this phase updates that doc's queries to match the determinism + completeness requirements above and embeds the final SQL in the connector.

### 5) Renderer: `SqlSchema` → Schema v2 directory

```ts
export type RenderOptions = {
  outDir: string;                   // "<schemaId>.schema/"
  schemaId: string;
  /** Optional — when present, ID-anchored merge runs against this directory's existing schema.json. */
  existingArtifactDir?: string;
};

export function renderToSchemaV2(schema: SqlSchema, options: RenderOptions): {
  schemaJsonPath: string;
  warnings: IntrospectionWarning[];
};
```

- Writes `schema.json` only. **Never** writes `tables/*.md`, `concepts.md`, or any describable-layer file.
- Uses the Phase 5 ID conventions exactly: `table:<schema>.<name>` (or `table:<name>` for `public` per the contract decision), `table:<schema>.<name>#<col>`. Multi-schema names use a dot inside the table name; the `#` separator stays reserved for column suffixes.
- Sensitive flags: not auto-detected in v0 (we don't try to guess "is this PII"). On a fresh introspection, all `sensitive` flags are `false`. On re-introspection, sensitive flags **set in the existing `schema.json`** are preserved (see merge below).
- The renderer emits a deterministic `schema.json`: top-level `schemas` ordered alphabetically, tables ordered alphabetically within a schema, columns in `ordinalPosition` order, FKs ordered by constraint name, etc. Two runs against an unchanged DB produce a **byte-identical** `schema.json`.

### 6) ID-anchored re-introspection merge

When `existingArtifactDir` is supplied, the renderer runs an ID-anchored merge instead of a clean write:

- Load the existing `schema.json` via the Phase 5 reader.
- For every table/column in the new `SqlSchema`, find the existing entry by **id** (`table:<schema>.<name>` and `table:<schema>.<name>#<col>`).
- **Same id, structural change**: update fields (type, nullable, default, etc.) in place. **Preserve the existing `sensitive` flag** if set (we never silently flip `sensitive: true` to `false`).
- **New id**: add the entry. Emit `{ code: "new_column", id, tableId }` warning.
- **Existing id with no match in the new schema**: drop the entry from `schema.json` (the column genuinely no longer exists). If any `tables/*.md` file references the orphan id (read via the Phase 5 loader), emit `{ code: "orphan_id", id, file }` warning. **Do not edit any `tables/*.md` file** — orphans are surfaced for the TUI (Phase 7) to act on.
- **Renames are not auto-detected** (matches Prisma's default; user picked the strict ID-anchored path). A renamed column is observed as one orphan + one new id. The TUI can offer rename UX later.

The describable layer (`tables/*.md`, `concepts.md`) is **read** only to produce orphan warnings; it is **never written or modified** by introspection.

### 7) `IntrospectionResult` and CLI surface

The library API (`introspect(input, renderOptions)`) returns the same `IntrospectionResult` regardless of mode. The CLI wraps the same call:

- `--out <dir>` — write artifact (default).
- `--print` — write to stdout instead (parallel to Prisma `--print`).
- `--diff <dir>` — print a structured diff vs. existing artifact; **no writes**.
- `--engine postgres` — selects the connector (Phase 6 only ships postgres; default).
- `--schemas <list>` / `--exclude-schemas <list>` / `--tables <glob>` — `IntrospectionFilters`.

CLI logging follows Phase 2's structured-logging conventions; events use the `askdb.introspect.*` prefix.

### 8) Documentation and fixtures

- `packages/introspect/README.md` with quickstart for both modes.
- `docs/integration/installable-package.md` extended with the canonical `introspect → enrich` flow (Phase 6 → Phase 7).
- A fixture `fixtures/schemas/orders-users.schema/` (the Phase 5 hand-authored fixture) becomes the **reference output** the Postgres connector reproduces when introspecting the corresponding Pagila-style DB.
- A pinned **catalog snapshot** for tests: `fixtures/introspect/orders-users.catalog.json` containing the rows the connector queries return for the test DB. Tests run the connector against the snapshot (no real DB needed in unit tests) and assert the exact `SqlSchema` and rendered `schema.json`.

## Out of scope

- **Non-Postgres engines** — Phase 11 introduces additional connectors against the same interface. Phase 6 ships Postgres only.
- **Heuristic rename detection** — explicitly chosen out: renames are remove + add. Future work can add a `--detect-renames` opt-in.
- **Capturing every Postgres feature in Schema v2** — RLS, partitioning, generated columns, expression indexes, etc. are captured in `SqlSchema` for completeness but are **not** emitted into `schema.json` until Schema v2 grows fields for them. The connector is forward-compatible with those extensions without a major version bump.
- **Auto-detecting sensitive columns** — column-name heuristics are intentionally not in scope. Sensitive flags are user-set in the TUI (Phase 7) or by hand and preserved across re-introspections.
- **Code generation à la Drizzle/Prisma** — we emit a describable artifact, not query builders.
- **Live-DB authoring inside the TUI** — Phase 7's TUI never opens a DB; the canonical flow is `askdb introspect` → `askdb-tui`.

## Spec decisions (from planning)

| Topic | Decision |
|---|---|
| Architecture | **Connector pattern** (Prisma-inspired). One `Connector` interface; per-engine implementations under `@askdb/introspect/<engine>` sub-exports. |
| First connector | **Postgres**, using `pg_catalog` primarily and `information_schema` for type strings. |
| Determinism | **Contract.** Every catalog query includes explicit `ORDER BY`; multi-column FKs preserve `pg_constraint.conkey` order; enum values preserve `pg_enum.enumsortorder`. Two runs against an unchanged DB produce byte-identical `schema.json`. |
| Two paths | **Live + air-gapped, both first-class.** Same connector; the difference is whether catalog rows arrive via `AskDbExecutor` or from a CSV/JSON bundle on disk. |
| Re-introspection | **ID-anchored merge** preserves stable IDs; new columns add; orphans drop from `schema.json` and emit warnings; **`tables/*.md` is never written**. No heuristic rename detection in v0. |
| Output | Schema v2 directory with **only `schema.json`**; the describable layer is owned by the TUI (Phase 7) and hand-authoring. |
| Sensitive | Not auto-detected; preserved across re-introspection. |
| Filters | `schemas` (include), `excludeSchemas`, `tables` glob; system schemas always excluded. Default `schemas: ["public"]`. |
| `IntrospectionResult` | `{ schema, warnings, isEmpty, viewDefinitions }` — mirrors Prisma's shape exactly so the surface is familiar to integrators. |
| CLI | `askdb introspect` (live + air-gapped + diff + print + templates); also `askdb-introspect` binary. |

## Open choices (to resolve during implementation)

- **Bundle format for air-gapped mode** — single zip vs. directory of CSV/JSON; ordering of files; whether to ship a small `manifest.json`. Recommendation: directory with `manifest.json` and one CSV per template (CSV is universal across DB tools); JSON variant accepted on read.
- **`templates()` distribution** — embedded as constants in the package vs. printed via `askdb introspect templates`. Recommendation: both — embedded for the connector to use, and a CLI subcommand to dump them so users can run them in `psql`.
- **Catalog SQL boundary with the legacy doc** — keep `docs/specs/postgres-introspection-for-askdb-schema-v1.md` as a referenceable historical artifact, or move all SQL into this spec? Recommendation: keep the legacy doc with a "superseded" banner, copy the final SQL into this phase's `requirements.md`, and link both ways.
- **`pg` peer dependency for live mode** — does `@askdb/introspect` need `pg` directly, or does it only ever go through `AskDbExecutor`? Recommendation: only through `AskDbExecutor` (no `pg` import in `@askdb/introspect`); the integrator constructs the executor (using the Phase 4 `createPostgresExecutor` factory or their own driver).

## Success (product)

After Phase 6:

1. A consumer with a live DB runs `askdb introspect --url postgres://...` and gets a `<schemaId>.schema/schema.json` with stable IDs ready for Phase 7 (TUI) or Phase 8 (RAG).
2. A consumer in a locked-down environment runs `askdb introspect templates --engine postgres > pg-templates.sql`, executes the queries in `psql`, gathers the rows into a bundle, and runs `askdb introspect --from-export ./bundle/` — getting an **identical** artifact without AskDB ever connecting.
3. Re-running introspection after a column is added produces a `schema.json` whose existing IDs are unchanged; the new column gets a fresh ID; `tables/*.md` files are unchanged on disk; warnings flag the new id for the TUI.
4. Multi-column foreign keys come back with their columns in the correct constraint order (regression guard for the documented Drizzle bug).
5. Two introspect runs against an unchanged database produce a byte-identical `schema.json` (determinism contract).

## References

- [`docs/contracts/schema-v2.md`](../../contracts/schema-v2.md) — format + ID conventions this phase writes
- [`docs/contracts/sensitive-fields-and-modes.md`](../../contracts/sensitive-fields-and-modes.md) — sensitive flag handling preserved across runs
- [`docs/mission.md`](../../mission.md) — schema-first; two-paths-to-the-same-artifact principle
- [`docs/platform.md`](../../platform.md) — `@askdb/introspect`, connector pattern, BYO seams
- [`docs/roadmap.md`](../../roadmap.md) — Phase 6
- [`docs/specs/phase-4-publish-npm/`](../phase-4-publish-npm/) — `AskDbExecutor` seam reused for live mode
- [`docs/specs/phase-5-schema-v2-core/`](../phase-5-schema-v2-core/) — v2 reader/writer + ID conventions this phase respects
- [`docs/specs/phase-7-tui-enrichment/`](../phase-7-tui-enrichment/) — downstream consumer (and the surface that turns orphan/new-column warnings into action)
- [`docs/specs/phase-8-rag/`](../phase-8-rag/) — downstream consumer
- [`docs/specs/postgres-introspection-for-askdb-schema-v1.md`](../postgres-introspection-for-askdb-schema-v1.md) — superseded; reference SQL still cited here
