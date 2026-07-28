# Plan 033: Prepare reusable parameterized queries once and rebind business + tenant values without AI

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report — do not improvise. When done, update the status row for this plan in `plans/README.md` — unless a reviewer dispatched you and told you they maintain the index.
>
> **Drift check (run first)**: `git diff --stat 9f5e600..HEAD -- packages/core/src packages/core/README.md packages/client/src packages/client/README.md docs/specs/core-pipeline.md docs/specs/multi-tenancy.md docs/contracts/tenant-policy.md apps/docs-site/src/content/docs/reference/core-api.mdx apps/docs-site/src/content/docs/reference/client-api.mdx apps/docs-site/src/content/docs/guides/embed-in-node.mdx apps/docs-site/src/content/docs/guides/multi-tenancy.mdx .changeset`
> If any in-scope file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: none (builds on the already-landed Phase 10 tenant placeholder layer and `@askdb/client` facade)
- **Category**: direction + performance + tech-debt
- **Planned at**: commit `9f5e600`, 2026-07-19

## Why this matters

Today every call to `ask()` invokes the language model, even when only a value inside an otherwise identical question changed (date range, threshold, status, customer id, etc.). This spends tokens, adds latency, and allows the model to produce a structurally different query for what should be the same report. Tenant IDs are already represented as named placeholders during generation, but that mechanism is resolved inside the same `ask()` call and discarded; a caller cannot retain the validated SQL shape and safely bind a new authorized tenant scope without asking the model again.

Add one shared two-phase contract:

1. The existing AI-backed `ask()` call may declare `{{named}}` business parameters. It returns the first bound query **and** a versioned, serializable `PreparedQuery` containing validated named-template SQL and its binding contract. Runtime values are not sent to the model and are not stored in the prepared artifact.
2. A synchronous `bindPreparedQuery()` function — exposed as `client.bind()` by `@askdb/client` — accepts new business values and, where applicable, a new tenant scope with the same access shape. It validates and binds locally. It never resolves a model, calls `generateText`, retrieves RAG chunks, or mutates the prepared artifact.

The same binder must own both business and tenant placeholders. Do not build a second general-purpose regex replacer beside `tenant-placeholders.ts`. The Phase 10 tenant behavior becomes a compatibility wrapper over the new binder, so combined business + tenant parameters have one deterministic ordering, one dialect-aware marker formatter, one unresolved-placeholder check, and one audit representation.

This is explicitly **not automatic caching**. Core remains stateless. The host chooses whether to retain a `PreparedQuery` in memory, a database, or its own cache, and chooses the cache key/TTL. That keeps invalidation, persistence, and cross-user authorization in the host where they belong.

## Current state

### Pipeline topology

```text
ask(options)
  ├─ validate tenantScope when schema has tenant-policy.md
  ├─ optional RAG retrieval using options.question
  ├─ dialect.generate(question, schema, model, ...)
  │    ├─ prompt model
  │    ├─ extract + validate SELECT
  │    └─ validate tenant guardrails against named :tenant_* placeholders
  └─ resolveTenantSql(generated.sql, policy, scope, tenantSqlMode)
       ├─ sql-only: inline tenant literals
       └─ sql-params: replace with PostgreSQL-style $N + tenantParams
```

There is no retained template. Calling `ask()` again with new values repeats the retrieval/model path.

### Relevant files and their roles

- `packages/core/src/ask.ts` — public pipeline options/result and orchestration.
- `packages/core/src/sql/generate.ts` — prompt/model/extract/validate boundary.
- `packages/core/src/sql/prompt.ts` — model-facing NL-to-SQL prompt.
- `packages/core/src/sql/tenant-prompt.ts` — asks the model for `:tenant_*` placeholders.
- `packages/core/src/sql/tenant-placeholders.ts` — current tenant-only regex extraction, literal replacement, and `$N` parameter replacement.
- `packages/core/src/sql/tenant-guardrail.ts` — validates tenant shape before tenant values are substituted.
- `packages/core/src/sql/dialect-spec.ts` — all built-in dialect IDs; currently does not describe execution-parameter marker style.
- `packages/core/src/errors.ts` and `packages/core/src/index.ts` — public errors and barrel exports.
- `packages/core/src/ask.test.ts`, `packages/core/src/sql/generate.test.ts`, `packages/core/src/sql/tenant-placeholders.test.ts`, and `packages/core/src/sql/tenant-consumer-smoke.test.ts` — existing test patterns.
- `packages/client/src/client.ts` — config-aware facade; `ask()` resolves cached schema/model/dialect, then delegates to core.
- `packages/client/src/client.test.ts` and `client.smoke.test.ts` — facade and external-consumer test patterns.
- `docs/specs/core-pipeline.md`, `docs/specs/multi-tenancy.md`, and `docs/contracts/tenant-policy.md` — internal behavioral contracts.
- `apps/docs-site/src/content/docs/reference/core-api.mdx` and `client-api.mdx` — canonical public API references.
- `apps/docs-site/src/content/docs/guides/embed-in-node.mdx` and `multi-tenancy.mdx` — host integration examples that must demonstrate reuse.

### Current public API excerpts

`packages/core/src/ask.ts:83-145` makes the question concrete and tenant parameterization tenant-specific:

```ts
export type AskPipelineOptions = {
  question: string;
  schema: AnyNormalizedSchema;
  model: AskDbLanguageModel;
  dialect: AskDialectInput;
  // ...
  tenantScope?: TenantScope;
  /**
   * SQL output mode for tenant placeholders. Default `"sql-only"` inlines
   * literal values; `"sql-params"` converts to positional `$N` parameters.
   */
  tenantSqlMode?: TenantSqlOutputMode;
};
```

`packages/core/src/ask.ts:147-155` exposes only tenant-specific values:

```ts
export type AskPipelineResult = {
  sql: string;
  explain?: unknown;
  tenantGuardrail?: TenantGuardrailResult;
  tenantParams?: unknown[];
  tenantBindings?: TenantBinding[];
  usage?: AskUsage;
};
```

`packages/core/src/ask.ts:184-213` generates, then immediately destroys the named tenant-template form:

```ts
const generated = await dialect.generate(
  options.question,
  options.schema,
  options.model,
  { /* prompt inputs */ },
);
// ...
if (tenantPolicy && options.tenantScope) {
  const mode = options.tenantSqlMode ?? "sql-only";
  const resolved = resolveTenantSql(sql, tenantPolicy, options.tenantScope, mode);
  result.sql = resolved.sql;
  if (resolved.bindings.length > 0) result.tenantBindings = resolved.bindings;
  if (resolved.mode === "sql-params" && resolved.params.length > 0) {
    result.tenantParams = resolved.params;
  }
}
```

`packages/core/src/sql/prompt.ts:73-103` provides no business-parameter contract to the model:

```ts
const lines = [
  `You translate natural language questions into a single ${dialect.displayName} SELECT (or WITH ... SELECT).`,
  "Rules:",
  // ...
];
// tenant policy is appended when present
lines.push(`Question: ${question}`);
```

`packages/core/src/sql/tenant-prompt.ts:70-90` already has the right internal idea — a stable named token instead of the concrete IDs — but it does not require a cardinality-stable SQL shape:

```ts
const placeholder = `:tenant_${rootLabel.toLowerCase().replace(/[^a-z0-9]+/g, "_")}_ids`;
lines.push(`  Access: ${rootLabel} IDs = ${placeholder}`);
lines.push(`  Use ${placeholder} as the parameter placeholder for tenant predicates.`);
```

`packages/core/src/sql/tenant-placeholders.ts:36-48, 141-165` scans/replaces by regex and always emits `$N`, even though AskDB has MySQL, SQLite, and SQL Server dialects:

```ts
const PLACEHOLDER_RE = /:tenant_([a-z0-9_]+)_ids/g;

export function extractTenantPlaceholders(sql: string): string[] {
  const matches = new Set<string>();
  for (const m of sql.matchAll(PLACEHOLDER_RE)) matches.add(m[0]);
  return [...matches];
}

export function replacePlaceholdersWithParams(/* ... */) {
  // ...
  const paramRef = `$${idx}`;
  // ...
}
```

It also changes query structure based on runtime list length by rewriting `=` to `IN` (`tenant-placeholders.ts:169-193`). A reusable template must instead have a stable `IN (:placeholder)` shape and only expand the markers inside the parentheses.

`packages/client/src/client.ts:74-78, 214-228` has only `ask()` and `reload()`; every `ask()` resolves a model before delegating:

```ts
export type AskDbClient = {
  ask(question: string, overrides?: AskOverrides): Promise<AskPipelineResult>;
  reload(): void;
};

async ask(question, overrides = {}) {
  // resolve schema + dialect
  const resolvedModel = await resolveModel(modelOverride, deps);
  return ask({ /* ... */ });
}
```

### Conventions to match

- Public types live next to the implementation that owns them and are re-exported from package `src/index.ts` barrels. Match `ask.ts` and `tenant-placeholders.ts` rather than adding a global `types.ts` dump.
- Core uses typed `AskDbError` subclasses with stable machine-readable reason unions (`packages/core/src/errors.ts:1-82`). Parameter failures should follow this pattern.
- Pure SQL helpers have focused colocated Vitest files under `packages/core/src/sql/`; pipeline integration stays in `ask.test.ts` or a focused `*-integration.test.ts`.
- Package scripts are `build`, `lint` (`tsc --noEmit`), and `test` (Vitest).
- Public package changes require a Changesets note. Core/client additions are minor releases while pre-1.0.
- Commit messages in this repo use conventional prefixes, e.g. `feat(core): ...`, `test(core): ...`, `docs: ...`.

### Verification baseline

The advisor verified the commands from the root/package manifests but did not complete a test baseline: the first `pnpm --filter ... test` invocation tried to bootstrap the workspace dependency tree, so it was stopped to preserve the read-only planning run. The executor must run `pnpm install --frozen-lockfile` and establish the baseline before editing. A pre-existing failure is a STOP condition, not something to absorb into this feature.

## Target public contract (do not redesign during implementation)

### Business parameter input

Add `queryParameters` and a generic `sqlOutputMode` to `AskPipelineOptions`:

```ts
export type QueryParameterType =
  | "string"
  | "number"
  | "boolean"
  | "date"
  | "datetime";

export type QueryParameterInput = {
  type: QueryParameterType;
  cardinality?: "one" | "many"; // default "one"
  description?: string;
  value: string | number | boolean | readonly (string | number | boolean)[];
};

export type SqlOutputMode = "sql-only" | "sql-params";

export type AskPipelineOptions = {
  // existing fields
  queryParameters?: Record<string, QueryParameterInput>;
  sqlOutputMode?: SqlOutputMode;
  /** @deprecated Use sqlOutputMode. */
  tenantSqlMode?: TenantSqlOutputMode;
};
```

Rules:

- Parameter names must match `^[a-z][a-z0-9_]*$`; `tenant_` and `askdb_` prefixes are reserved.
- Every key must appear exactly as a `{{name}}` token in the question; every `{{name}}` token must have one definition. Duplicate uses of the same token are allowed.
- Canonical SQL placeholders are `:askdb_param_<name>` for business values and the existing `:tenant_<root_slug>_ids` for tenant values.
- `cardinality: "many"` requires a non-empty array. It may appear in generated SQL only as the sole value inside `IN (...)` or `NOT IN (...)`. `"one"` rejects arrays. Null/undefined, non-finite numbers, `Date` objects, objects, and mixed-type arrays are rejected in v1. Dates/datetimes are ISO strings; core validates shape but leaves database type coercion to the driver.
- Prompt text receives the canonical placeholder, type, cardinality, and optional description. It never receives `value`. RAG retrieval should use the question with `{{name}}` intact (semantic name remains useful), not the concrete value.
- When `queryParameters` is present and neither output mode field is supplied, default to `"sql-params"`. Calls without business parameters retain the current tenant-only default (`tenantSqlMode ?? "sql-only"`). If both mode fields are supplied with different values, throw a typed error before the model call.

Example:

```ts
const first = await ask({
  question: "Revenue between {{start_date}} and {{end_date}} for {{statuses}}",
  queryParameters: {
    start_date: { type: "date", value: "2026-07-01" },
    end_date: { type: "date", value: "2026-08-01" },
    statuses: {
      type: "string",
      cardinality: "many",
      description: "Order statuses to include",
      value: ["paid", "shipped"],
    },
  },
  schema,
  model,
  dialect: "postgres",
});
```

The model-facing question must name `:askdb_param_start_date`, `:askdb_param_end_date`, and `:askdb_param_statuses`; it must not include `2026-07-01`, `2026-08-01`, `paid`, or `shipped`.

### Prepared and bound output

Add these versioned public types (exact field names are part of the plan):

```ts
export type PreparedQueryParameter = {
  name: string;
  placeholder: string;
  type: QueryParameterType;
  cardinality: "one" | "many";
  description?: string;
  source: "question";
};

export type PreparedTenantBinding = {
  placeholder: string;
  rootId: string;
  rootLabel: string;
  source: "tenant";
  cardinality: "many";
};

export type PreparedTenantContract = {
  schemaId: string;
  policyFingerprint: string;
  accessShape:
    | { kind: "ids"; tenantRoot: string }
    | { kind: "subtree"; tenantRoot: string; includeDescendants: true }
    | { kind: "multi_root"; tenantRoots: string[] }
    | { kind: "global" };
  contextFingerprint: string;
  reusable: boolean;
  nonReusableReason?: "tenant_filters_present";
};

export type PreparedQueryV1 = {
  version: 1;
  dialect: BuiltInDialectId;
  schemaId: string | null;
  schemaFingerprint: string;
  templateSql: string;
  queryParameters: PreparedQueryParameter[];
  tenantBindings: PreparedTenantBinding[];
  tenant?: PreparedTenantContract;
};

export type SqlBinding = {
  position: number;          // 1-based occurrence order
  marker: string | null;    // "$1", "?", "@p0"; null in sql-only mode
  name: string;             // business name or tenant root id
  source: "question" | "tenant";
  value: string | number | boolean;
};

export type BoundQuery = {
  sql: string;
  params: Array<string | number | boolean>;
  bindings: SqlBinding[];
};

export type AskPipelineResult = {
  sql: string;
  params?: Array<string | number | boolean>;
  bindings?: SqlBinding[];
  preparedQuery?: PreparedQueryV1;
  // existing explain/usage/tenant fields remain
};
```

`preparedQuery` is present whenever business parameters exist or a non-global tenant scope produced tenant placeholders **and the resolved dialect is a built-in ID/spec**. Existing custom `AskDialect` tenant-only calls keep their legacy bound result without a prepared artifact. A prepared artifact must contain definitions, structural fingerprints, and template SQL only — never raw runtime business values or tenant IDs.

Keep `tenantParams` and `tenantBindings` for compatibility. They remain the tenant-only subsets of generic `params`/`bindings`. Document that callers who opt into `queryParameters` must execute with generic `params`, because `tenantParams` deliberately omits business values. Mark `tenantSqlMode` and `tenantParams` deprecated in JSDoc, but do not remove or silently change them. In `sql-only` mode, `BoundQuery.params` is an empty array and each binding has a null marker; the values remain available in binding metadata for audit.

### Local rebind API

Export the synchronous core function:

```ts
export function bindPreparedQuery(
  prepared: PreparedQueryV1,
  input: {
    schema: AnyNormalizedSchema;
    queryParameterValues?: Record<string, string | number | boolean | readonly (string | number | boolean)[]>;
    tenantScope?: TenantScope;
    sqlOutputMode?: SqlOutputMode; // default "sql-params"
  },
): BoundQuery;
```

Add the facade method:

```ts
export type AskDbClient = {
  ask(question: string, overrides?: AskOverrides): Promise<AskPipelineResult>;
  bind(
    prepared: PreparedQueryV1,
    input: Omit<BindPreparedQueryInput, "schema"> & { schema?: SchemaSource | AnyNormalizedSchema },
  ): BoundQuery;
  reload(): void;
};
```

`client.bind()` resolves the current/default schema using the existing schema resolution path, then calls core. It must not call `resolveModel`, the AI registry, `generateText`, the retriever, `onResolve`, or a logger pipeline generation event. Add a test proving the registry and model mock call counts do not change across multiple binds.

### Dialect marker rules

The binder emits execution markers from `prepared.dialect`:

| Dialect | SQL marker | `params` behavior |
| --- | --- | --- |
| `postgres`, `cockroachdb` | `$1`, `$2`, ... | occurrence order |
| `mysql`, `mariadb`, `sqlite` | `?` | one value per marker occurrence |
| `sqlserver` | `@p0`, `@p1`, ... | occurrence order; binding metadata carries the name |

Repeated scalar placeholders may reuse the same value semantically but still allocate one marker/value per occurrence. This uniform rule is necessary for `?` dialects and makes the audit list deterministic. List placeholders expand to comma-separated markers inside the already-existing `IN (...)` parentheses.

Reusable parameterization is supported only when `dialect` is a built-in ID or a `DialectSpec` whose `id` is built-in. A custom `AskDialect` remains supported for ordinary `ask()` calls. Using it with `queryParameters` must throw before the model call; a legacy custom-dialect tenant-only call continues to bind as today but does not receive a reusable prepared artifact. Do not guess its driver marker convention. Document this restriction on `AskDialect`.

### Tenant rebind rules

Tenant IDs are values; tenant policy/access structure and advisory context are generation inputs. Therefore `bindPreparedQuery()` may change only the ID arrays while preserving the prepared scope shape:

- `ids`: same `tenantRoot`, new non-empty `ids` allowed.
- `subtree`: same `tenantRoot` and `includeDescendants: true`, new non-empty `rootIds` allowed.
- `multi_root`: same set of root IDs (sort before comparing), new non-empty ID arrays allowed.
- `global`: may bind business parameters, but supplied scope must remain global. A global prepared query can never be rebound to scoped access or the reverse.
- `context`: must deep-equal the originally prepared context by canonical fingerprint. A changed role, region, description, attributes, or label may change query semantics and requires a new AI call.
- `tenantFilters`: current code does not turn these polymorphic conditions into reusable placeholders. If present during preparation, set `tenant.reusable = false` and `nonReusableReason = "tenant_filters_present"`; every `bindPreparedQuery()` attempt throws a clear "regenerate this query" error, including a business-only rebind. Do not pretend partial rebinding is safe when part of the tenant predicate remains concrete/model-generated.

On every bind, require the current schema, re-run `validateTenantScope`, compare the schema/policy/context fingerprints and access shape, re-run `validateTenantGuardrails` against `templateSql`, and reject any mismatch before substitution. This lets tenant IDs change without a model call while preserving the existing fail-closed boundary.

### Template integrity rules

Implement a small SQL-aware placeholder scanner, not `String.replace` over the whole query. It must recognize canonical placeholders only outside:

- single-quoted string literals (including doubled quote escapes),
- double-quoted identifiers,
- MySQL backtick identifiers,
- SQL Server bracket identifiers, and
- PostgreSQL dollar-quoted strings.

Comments are already rejected by `validateSelectSql`, so the scanner need not support comment bodies. The scanner must return occurrence offsets and token names so replacement happens from right to left without invalidating offsets.

After generation and again before/after every bind, enforce:

- every declared business parameter appears at least once;
- no undeclared `:askdb_param_*` placeholder exists;
- every tenant placeholder maps to exactly one policy root;
- tenant root labels do not slug to the same placeholder;
- `many`/tenant placeholders appear only as the sole expression inside `IN (...)` or `NOT IN (...)`;
- all placeholders are resolved after binding; and
- the final SQL still passes `validateSelectSql` for the prepared dialect.

Throw a typed `QueryParameterError extends AskDbError` with a reason union such as `INVALID_NAME`, `QUESTION_TOKEN_MISMATCH`, `INVALID_VALUE`, `UNDECLARED_PLACEHOLDER`, `MISSING_PLACEHOLDER`, `INVALID_LIST_CONTEXT`, `UNRESOLVED_PLACEHOLDER`, `SCHEMA_MISMATCH`, `DIALECT_UNSUPPORTED`, and `TENANT_SCOPE_SHAPE_CHANGED`. Keep messages actionable and do not include sensitive values.

## Commands you will need

| Purpose | Command | Expected on success |
| --- | --- | --- |
| Install | `pnpm install --frozen-lockfile` | exit 0; lockfile unchanged |
| Core baseline/focused tests | `pnpm --filter @askdb/core test` | exit 0; all core tests pass |
| Client baseline/focused tests | `pnpm --filter @askdb/client test` | exit 0; all client tests pass |
| Core typecheck | `pnpm --filter @askdb/core lint` | exit 0; no TypeScript errors |
| Client typecheck | `pnpm --filter @askdb/client lint` | exit 0; no TypeScript errors |
| Full test suite | `pnpm test` | exit 0; all workspace tests pass |
| Full typecheck | `pnpm lint` | exit 0; all workspace typechecks pass |
| Docs build | `pnpm docs:build` | exit 0; Astro/Starlight build succeeds |
| Installable package check | `pnpm smoke:install` | exit 0; packed consumer smoke passes |
| Release preflight | `pnpm preflight` | exit 0 |

## Scope

**In scope** (the only source/docs files that should be modified):

- `packages/core/src/ask.ts`
- `packages/core/src/errors.ts`
- `packages/core/src/index.ts`
- `packages/core/src/sql/generate.ts`
- `packages/core/src/sql/prompt.ts`
- `packages/core/src/sql/tenant-prompt.ts`
- `packages/core/src/sql/tenant-placeholders.ts`
- `packages/core/src/sql/query-parameters.ts` (create; owns public prepared/bind types, scanner, validation, fingerprinting, and binding)
- focused tests under `packages/core/src/` for the files above (create `packages/core/src/sql/query-parameters.test.ts`; extend existing tests where their current contract is directly affected)
- `packages/core/README.md`
- `packages/client/src/client.ts`
- `packages/client/src/index.ts`
- `packages/client/src/client.test.ts`
- `packages/client/src/client.smoke.test.ts`
- `packages/client/README.md`
- `docs/specs/core-pipeline.md`
- `docs/specs/multi-tenancy.md`
- `docs/contracts/tenant-policy.md`
- `apps/docs-site/src/content/docs/reference/core-api.mdx`
- `apps/docs-site/src/content/docs/reference/client-api.mdx`
- `apps/docs-site/src/content/docs/guides/embed-in-node.mdx`
- `apps/docs-site/src/content/docs/guides/multi-tenancy.mdx`
- one new `.changeset/*.md`
- `plans/README.md` (status only)

**Out of scope** (do not touch, even though related):

- `apps/studio/**` — a visual parameter editor/re-execute flow is a follow-up after the core artifact contract exists. Existing Studio tests must still pass through compatibility fields.
- `apps/http-api/**` — do not accept caller-supplied prepared SQL over a network boundary. A future HTTP design needs an opaque server-side prepared-query ID, bounded TTL/LRU storage, and ownership/auth checks; a raw `/bind` endpoint is unsafe.
- `apps/cli/**` — the one-shot CLI does not benefit from in-process rebinding.
- Any built-in automatic cache, cache key, TTL, persistence adapter, encryption, or signing mechanism.
- Reusable `tenantFilters`; v1 must fail closed as specified above.
- Automatic parameter discovery/extraction by the model. Hosts declare tokens explicitly; do not let the model decide which literals are editable.
- SQL AST/parser dependencies or broad replacement of the existing heuristic SELECT/tenant guardrails.
- Database execution. AskDB still returns SQL + params; the host executes.
- Changes to schema artifact formats or `tenant-policy.md` front-matter.

## Git workflow

- Keep the current branch name unless the operator directs otherwise.
- Make logical commits if asked to commit: suggested sequence is `feat(core): add reusable prepared query binding`, `feat(client): expose local prepared query binding`, then `docs: document reusable query parameters`.
- Add one changeset covering minor releases for `@askdb/core` and `@askdb/client`. The root Changesets config links core with the CLI/HTTP release train; let Changesets calculate linked version consequences instead of hand-editing package versions/changelogs.
- Do not push or open a PR unless the operator explicitly requests it.

## Steps

### Step 1: Establish the baseline and lock the contract in tests

Run install, core/client tests, and core/client lint before editing. Record the counts/output in the implementation handoff. Then add failing tests for the target contract before implementation.

Tests must cover:

1. Input/token validation before `generateText` is called.
2. Prompt includes placeholder/type/cardinality/description but excludes every concrete value.
3. Model SQL with missing, undeclared, unresolved, or incorrectly placed list placeholders is rejected.
4. `PreparedQueryV1` JSON round-trip preserves bind behavior and contains no supplied values/tenant IDs.
5. Each built-in dialect emits the marker style in the table above.
6. Repeated scalar and multi-value parameters preserve occurrence order.
7. Scanner ignores placeholder-looking text inside every supported quote form.
8. Empty/mixed arrays, nulls, objects, and non-finite numbers fail before the model/binder.
9. Existing no-parameter `ask()` result/prompt snapshots remain unchanged.
10. Existing tenant-only `sql-only` and `sql-params` tests retain their public behavior.
11. Combined business + tenant values produce one correct `params` array plus correct deprecated tenant-only subsets.
12. Rebinding new values does not call `generateText` or a retriever.
13. Tenant scope shape/context/schema/policy mismatches fail closed; changing IDs within the same shape succeeds.
14. `tenantFilters` follow the explicit non-reusable behavior.

**Verify**: `pnpm --filter @askdb/core test` should fail only in the newly added target tests before implementation; all pre-existing tests remain green.

### Step 2: Add the typed parameter/template model and SQL-aware binder

Create `packages/core/src/sql/query-parameters.ts` with the public types and pure helpers specified in “Target public contract.” Keep responsibilities separated inside the file (or private submodules only if the file becomes unreviewable):

- question-token/spec validation;
- canonical placeholder generation;
- canonical stable serialization + SHA-256 fingerprint helpers;
- SQL-aware placeholder scanning and context validation;
- tenant access-shape derivation/comparison;
- dialect marker formatting;
- literal formatting for compatibility `sql-only`; and
- `bindPreparedQuery()` orchestration.

Fingerprint the entire generation-relevant normalized schema (including descriptions/concepts and normalized tenant policy), not just table IDs. Use a canonical recursive key sorter before hashing so equivalent objects do not change fingerprints because of property insertion order. Do not include runtime business values or tenant access ID arrays in the schema/policy fingerprints. The context fingerprint intentionally hashes the exact advisory input so a binder can prove it did not change without storing its raw values in the prepared artifact. Tenant filters make the whole artifact non-reusable in V1 and therefore need no stored fingerprint.

Literal formatting rules for `sql-only` are type-driven: quote/escape string/date/datetime values, allow only finite numbers, emit `TRUE`/`FALSE` for booleans, and expand lists inside `IN (...)`. Never interpolate by calling `String(value)` on an unvalidated value.

Keep `resolveTenantSql`, `extractTenantPlaceholders`, and public tenant types exported. Reimplement/wrap them over the shared scanner/binder primitives where possible without changing current signatures. Delete the operator-aware `=`→`IN` dependency only after `tenant-prompt.ts` and tests require stable `IN (:tenant_..._ids)` syntax.

**Verify**: `pnpm --filter @askdb/core test -- query-parameters` → the new pure binder/scanner test file passes.

### Step 3: Teach prompt/generation to produce a validated named template

Thread validated parameter definitions (never their values) through `AskDialectGenerateOptions` / `GenerateSqlDeps` into `buildNlToSqlUserPrompt()`.

Append a compact “Query parameters” prompt block before the question. It must:

- map each `{{name}}` token to `:askdb_param_<name>`;
- list type, cardinality, and optional description;
- instruct the model never to inline/example the current value;
- require scalar placeholders in the relevant expression; and
- require many-valued placeholders as `IN (:placeholder)` or `NOT IN (:placeholder)` with the placeholder as the sole list member.

Update `tenant-prompt.ts` to require the same stable `IN (:tenant_<root>_ids)` shape for every non-global tenant root. Keep the tenant policy block unconditional when a policy exists.

After `extractSqlFromModelText()` and `validateSelectSql()`, validate the named template against both declared business specs and tenant policy bindings before tenant guardrails run. Tenant guardrails must continue to inspect the named template, never bound/literal SQL.

When no query parameters exist, the prompt must remain byte-for-byte identical except for the intentional tenant `IN (...)` instruction change. Preserve the existing custom `AskDialect` path for ordinary, non-prepared asks.

**Verify**: `pnpm --filter @askdb/core test -- generate tenant-prompt tenant-guardrail` → all matching tests pass and prompt assertions prove values are absent.

### Step 4: Integrate preparation + first binding into `ask()` compatibly

In `ask.ts`:

1. Validate question tokens and parameter inputs before retrieval/model work.
2. Keep retrieval keyed on the tokenized semantic question with no values.
3. Generate and guardrail-check named template SQL.
4. Construct `PreparedQueryV1` from the generated template, current normalized schema, dialect, parameter definitions, and tenant contract.
5. Call the same `bindPreparedQuery()` used by external rebinds with the current values/scope.
6. Populate `sql`, generic `params`/`bindings`, `preparedQuery`, and existing explain/usage/tenant fields.

No-parameter, non-tenant calls should keep the lean existing result (do not add an empty prepared artifact). Preserve tenant-only mode defaults and deprecated field values. Resolve the generic/legacy output-mode precedence exactly as specified; test conflicts before the model call.

Add `QueryParameterError` + reason exports in `errors.ts`/`index.ts`. Export all new public types and `bindPreparedQuery` from core’s barrel.

**Verify**: `pnpm --filter @askdb/core test && pnpm --filter @askdb/core lint` → exit 0, all core tests/typechecks pass.

### Step 5: Add `client.bind()` without touching the model path

Extend `AskDbClient` and the returned facade object with `bind()` using the existing `loadFromSource` / default-schema cache. Do not resolve a model or call `onResolve`; dialect is read from the serialized prepared contract and checked against current schema/config resolution only to detect mismatch.

Tests must call `askdb.ask()` once with a `generateText` spy, JSON-round-trip the prepared artifact, call `askdb.bind()` at least twice with new business and tenant values, and assert:

- SQL template structure is unchanged;
- params change as requested;
- generation spy and registry model factory remain at one call;
- schema mismatch and tenant access-shape change reject; and
- `reload()` causes schema re-resolution but never model resolution during `bind()`.

Update client barrel exports and consumer smoke test so a TypeScript consumer can import/use `PreparedQueryV1` and `BoundQuery` through the documented public packages.

**Verify**: `pnpm --filter @askdb/client test && pnpm --filter @askdb/client lint` → exit 0; all client tests/typechecks pass.

### Step 6: Document the lifecycle and security boundary

Update package READMEs, internal specs, and the four docs-site pages in scope. Use one consistent example:

```ts
const first = await askdb.ask(
  "Revenue between {{start_date}} and {{end_date}}",
  {
    queryParameters: {
      start_date: { type: "date", value: "2026-07-01" },
      end_date: { type: "date", value: "2026-08-01" },
    },
    tenantScope,
  },
);

await pool.query(first.sql, first.params);

const julyForAnotherAuthorizedTenant = askdb.bind(first.preparedQuery!, {
  queryParameterValues: {
    start_date: "2026-07-08",
    end_date: "2026-07-15",
  },
  tenantScope: sameShapeWithNewAuthorizedIds,
});

await pool.query(
  julyForAnotherAuthorizedTenant.sql,
  julyForAnotherAuthorizedTenant.params,
);
```

Docs must say plainly:

- first `ask()` = one AI call; each `bind()` = zero AI/RAG calls;
- values are not sent to the model or stored in `PreparedQuery`;
- the host owns prepared-query caching/invalidation and remains responsible for authorizing tenant IDs before passing scope;
- changing question meaning, parameter definitions, schema, dialect, tenant access shape, context, or tenant filters requires a fresh `ask()`;
- use generic `params` for combined business + tenant execution;
- prepared artifacts are trusted application data, not safe bearer tokens for an unauthenticated HTTP bind endpoint; and
- driver examples for PostgreSQL/MySQL/SQLite/SQL Server use the marker style actually returned for that dialect.

Update the tenant contract’s named-placeholder/output section so it describes the shared binder and deprecation path instead of a tenant-only `$N` layer.

**Verify**: `pnpm docs:build` → exit 0, no broken links or MDX errors.

### Step 7: Add release metadata and run the complete gates

Create one Changesets file with minor bumps for `@askdb/core` and `@askdb/client`. Mention the additive prepared/bind API, dialect-correct marker output, tenant compatibility fields/deprecations, and the explicit limitation on custom `AskDialect` + reusable parameters.

Run all release gates. Inspect `git diff --check`, `git status --short`, and the final diff to ensure no out-of-scope surface changed and no runtime values were copied into snapshots/docs.

**Verify**:

```bash
pnpm test
pnpm lint
pnpm docs:build
pnpm smoke:install
pnpm preflight
git diff --check
```

All commands exit 0. `git status --short` lists only files permitted by Scope (plus `plans/README.md` status if the executor owns it).

## Test plan

Use existing tests as structural exemplars:

- `packages/core/src/sql/tenant-placeholders.test.ts` — pure replacement and ask integration style; migrate assertions to shared binder semantics without erasing compatibility coverage.
- `packages/core/src/sql/generate.test.ts:28-145` — prompt capture with a `generateText` spy and pre-model failure assertions.
- `packages/core/src/sql/tenant-consumer-smoke.test.ts` — external tenant consumer behavior; add combined parameter/tenant reuse.
- `packages/core/src/ask.test.ts` — custom dialect and pipeline option forwarding.
- `packages/client/src/client.test.ts:110+` — config/schema/model resolution matrix and call-count spies.
- `packages/client/src/client.smoke.test.ts` — package-barrel consumer compile/runtime smoke.

Required cases:

- Normal scalar date/number/string/boolean binding.
- Normal list binding with 1 and N values; zero rejected.
- Combined normal + single-root tenant scope.
- Combined normal + multi-root tenant scope.
- Same template rebound repeatedly with new values and exactly one AI call.
- Postgres/Cockroach, MySQL/MariaDB, SQLite, and SQL Server markers.
- Placeholder-like text in all quote styles is untouched.
- Question/spec mismatch and model-template mismatch fail before returning SQL.
- Schema/policy/access/context drift fail closed.
- Tenant filters are explicitly non-reusable.
- Global tenant scope cannot become scoped during rebind.
- Deprecated tenant-only fields retain current tenant-only behavior.
- Custom `AskDialect` ordinary call remains green; reusable-parameter request rejects with `DIALECT_UNSUPPORTED` before a misleading artifact is returned.

## Done criteria

ALL must hold:

- [ ] A question with explicit `{{name}}` tokens returns bound SQL, generic params/bindings, and a JSON-serializable `PreparedQueryV1` after one AI call.
- [ ] Rebinding that artifact with new business values makes zero AI and zero RAG calls.
- [ ] Tenant IDs can be rebound only for the same validated access shape; schema/policy/context/root/kind changes fail closed.
- [ ] Prepared artifacts contain no business values or tenant IDs.
- [ ] Scalar/list rules and unresolved/undeclared placeholders are validated both after generation and before/after binding.
- [ ] Parameter scanning does not replace placeholder-looking text inside SQL literals or quoted identifiers.
- [ ] Final markers are dialect-correct for all built-in dialects.
- [ ] `tenantSqlMode`, `tenantParams`, `tenantBindings`, and tenant-only calls remain compatible and are documented as deprecated where specified.
- [ ] Existing no-parameter prompts/results remain unchanged.
- [ ] Public core/client barrel imports compile in consumer smoke tests.
- [ ] Core/client READMEs, internal contracts, and docs-site reference/guides describe the exact implemented API and trust boundary.
- [ ] A Changesets note covers the core/client public feature.
- [ ] `pnpm test`, `pnpm lint`, `pnpm docs:build`, `pnpm smoke:install`, `pnpm preflight`, and `git diff --check` all exit 0.
- [ ] No files outside the in-scope list are modified.
- [ ] `plans/README.md` marks plan 033 DONE (unless maintained by reviewer).

## STOP conditions

Stop and report back; do not improvise if:

- Any in-scope current-state excerpt has materially drifted from commit `9f5e600`, especially the public `ask()`/client types or tenant placeholder semantics.
- The baseline core/client tests or typechecks fail before feature edits.
- A correct implementation appears to require editing Studio, HTTP API, CLI, schema artifact formats, or a database adapter package.
- Supporting reusable parameters for a custom `AskDialect` requires guessing a marker style or changing its required public contract. Keep the documented restriction and report instead.
- A proposed prepared artifact contains any runtime business value, tenant ID, API key, database credential, or query result.
- Tenant guardrails can only be made to pass by validating after substitution instead of against named template SQL.
- Rebinding `tenantFilters` cannot be made structurally safe without expanding scope. Preserve the explicit fail-closed limitation.
- A many-valued placeholder cannot be proven to be the sole expression inside `IN (...)` / `NOT IN (...)`; reject the model output instead of adding more operator-aware SQL rewriting.
- The final implementation would accept a schema/dialect/context/access-shape mismatch and “best effort” bind it.
- Any verification step fails twice after a reasonable correction.

## Maintenance notes

- `PreparedQueryV1.version` is a serialization contract. Add a V2 and migration path for future shape changes; never reinterpret stored V1 artifacts.
- Host caches must include their own authorization/user boundary and expiry. `schemaFingerprint` detects drift but is not an authorization token or an HMAC signature.
- If a future HTTP bind surface is added, store prepared artifacts server-side behind opaque, user-owned IDs with bounded TTL/LRU; do not trust a raw artifact posted by a client merely because it passes SELECT validation.
- A future Studio plan can build a parameter editor from `preparedQuery.queryParameters`, call a local bind route, and execute the returned `sql` + generic `params` without showing another token-usage event.
- Automatic parameter extraction is deliberately deferred. Explicit tokens are deterministic, auditable, and prevent the model from silently deciding which literals a user may alter.
- A future reusable `tenantFilters` design must model each column/operator as immutable structure and each filter value as an explicit prepared binding.
- Reviewers should scrutinize quote-state scanning, list-context validation, fingerprint contents, dialect marker ordering, deprecated tenant subset fields, and every path that could bind a tenant artifact against a different scope shape.
