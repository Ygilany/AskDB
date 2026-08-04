# Plan 033: Return unbound SQL + a parameter manifest alongside the bound SQL, and share one binder with tenant scoping

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report — do not improvise. When done, update the status row for this plan in `plans/README.md` — unless a reviewer dispatched you and told you they maintain the index.
>
> **Drift check (run first)**: `git diff --stat c81bb4e..HEAD -- packages/core/src packages/core/README.md packages/client/src packages/client/README.md docs/specs/core-pipeline.md docs/specs/multi-tenancy.md docs/contracts/tenant-policy.md apps/docs-site/src/content/docs/reference/core-api.mdx apps/docs-site/src/content/docs/reference/client-api.mdx apps/docs-site/src/content/docs/guides/embed-in-node.mdx apps/docs-site/src/content/docs/guides/multi-tenancy.mdx .changeset`
> If any in-scope file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED
- **Depends on**: none (builds on the already-landed Phase 10 tenant placeholder layer and `@askdb/client` facade)
- **Category**: direction + dx
- **Planned at**: commit `c81bb4e`, 2026-08-04

## Why this matters

Today `ask()` returns one thing: a bound SQL string with the question's values baked in as literals. A host that wants to let a user tweak a value — a date range, a threshold, a status list — has no machine-readable description of which values in that SQL came from the question, so it cannot build a form around the query. Its only option is to send a new question and pay for another model call.

This plan changes what comes *back* from the model, not what goes in. The question is still sent exactly as it is today, values inline. The model additionally returns the SQL in unbound form plus a small JSON manifest naming each value it parameterized. AskDB validates that manifest, binds it, and returns **bound SQL (as today), unbound SQL, the ordered params array, and per-parameter metadata**. The host picks which to execute, and can render a dynamic form from the metadata.

Re-binding after a form edit is the host's business, but AskDB exposes the same pure binder it uses internally as `bindPreparedQuery()` so hosts do not have to re-implement dialect marker rules. That binder is shared with the existing tenant placeholder path, so business values and tenant IDs go through one scanner, one marker allocator, and one occurrence ordering.

**This is not a cache and not a second pipeline.** Every `ask()` still makes exactly one model call. Nothing here lets a caller skip the model.

## Assumptions this plan makes

Two decisions were made when this plan was written. If either is wrong, that is a STOP condition, not something to reinterpret.

1. **The feature is opt-in via `parameterize: true` and defaults to `false`.** Existing callers must see byte-identical prompts and byte-identical result objects. Flipping the default to `true` is a separate, later decision once the manifest path has real-world mileage.
2. **The model decides what to parameterize.** There is no `{{token}}` syntax for hosts to declare parameters, and no post-hoc extraction of literals from unchanged model output. Host-declared parameters were considered and deliberately deferred (see "Maintenance notes").

## Current state

### Pipeline topology

```text
ask(options)
  ├─ validate tenantScope when schema has tenant-policy.md
  ├─ optional RAG retrieval using options.question
  ├─ dialect.generate(question, schema, model, ...)
  │    ├─ prompt model
  │    ├─ extract fenced SQL + validateSelectSql
  │    └─ validateTenantGuardrails against named :tenant_* placeholders
  └─ resolveTenantSql(generated.sql, policy, scope, tenantSqlMode)
       ├─ sql-only (default): inline tenant literals
       └─ sql-params: replace with PostgreSQL-style $N + tenantParams
```

### Relevant files and their roles

- `packages/core/src/ask.ts` — public pipeline options/result and orchestration.
- `packages/core/src/sql/generate.ts` — prompt/model/extract/validate boundary.
- `packages/core/src/sql/extract-sql.ts` — pulls the fenced SQL block out of model text.
- `packages/core/src/sql/prompt.ts` — model-facing NL→SQL prompt assembly.
- `packages/core/src/sql/tenant-prompt.ts` — builds the tenant policy prompt block, including `:tenant_*` placeholder instructions.
- `packages/core/src/sql/tenant-placeholders.ts` — tenant-only regex extraction, literal replacement, and `$N` parameter replacement.
- `packages/core/src/sql/tenant-guardrail.ts` — validates tenant predicate shape against named-template SQL.
- `packages/core/src/sql/validate.ts` — read-only SELECT guardrail; contains an existing SQL string-literal stripper.
- `packages/core/src/sql/dialect-spec.ts` — all built-in dialect specs; currently describes no execution-parameter marker style.
- `packages/core/src/errors.ts` — typed `AskDbError` subclasses with machine-readable reason unions.
- `packages/core/src/logging/log-events.ts` — stable structured-log event names.
- `packages/core/src/index.ts` and `packages/core/src/sql/index.ts` — public barrels.
- `packages/client/src/client.ts` — config-aware facade. **Requires no source change** (see Step 7).

### Current public API excerpts

`packages/core/src/ask.ts:83-145` — options; note `tenantSqlMode` is the only output-shape control today:

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

`packages/core/src/ask.ts:147-155` — result exposes only tenant-specific values:

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

`packages/core/src/ask.ts:206-214` — tenant binding happens after generation, and `resolveTenantSql` already accepts a start index for marker numbering (`tenant-placeholders.ts:204-241`), which this plan uses to keep business and tenant markers in one sequence:

```ts
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

`packages/core/src/sql/extract-sql.ts:4-11` — **the language tag is optional**, so with two fenced blocks in the reply this returns whichever block comes first, regardless of language:

```ts
export function extractSqlFromModelText(raw: string): string {
  const text = raw.trim();
  const fence = /```(?:sql)?\s*([\s\S]*?)```/im.exec(text);
  if (fence?.[1]) {
    return fence[1].trim();
  }
  return text.trim();
}
```

`packages/core/src/sql/tenant-placeholders.ts:34-50` — tenant scanning is a bare global regex over the whole string, with no awareness of string literals or quoted identifiers:

```ts
const PLACEHOLDER_RE = /:tenant_([a-z0-9_]+)_ids/g;

export function extractTenantPlaceholders(sql: string): string[] {
  const matches = new Set<string>();
  for (const m of sql.matchAll(PLACEHOLDER_RE)) {
    matches.add(m[0]);
  }
  return [...matches];
}
```

`packages/core/src/sql/tenant-placeholders.ts:172-194` — operator-aware replacement rewrites `=` to `IN` when a scope carries multiple IDs. **This behavior must be preserved exactly**; every existing tenant fixture in the repo emits the scalar `= :tenant_agency_ids` form (e.g. `tenant-ask-integration.test.ts:42`, `tenant-consumer-smoke.test.ts:72`, `tenant-guardrail.test.ts:26`):

```ts
function replaceOperatorAware(sql, placeholder, replacement, isMultiple) {
  if (isMultiple) {
    const eqPattern = new RegExp(`=\\s*${escapeRegex(placeholder)}`, "g");
    sql = sql.replace(eqPattern, `IN ${replacement}`);
    const inPattern = new RegExp(`IN\\s*\\(\\s*${escapeRegex(placeholder)}\\s*\\)`, "gi");
    sql = sql.replace(inPattern, `IN ${replacement}`);
  }
  sql = sql.replace(new RegExp(escapeRegex(placeholder), "g"), replacement);
  return sql;
}
```

`packages/core/src/sql/validate.ts:110-153` — there is already a quote-state machine here (`stripSqlStringLiterals`) covering single quotes with doubled-quote escapes, double-quoted identifiers, and PostgreSQL dollar-quoting. It does **not** cover MySQL backticks or SQL Server brackets. Step 3 extends this into one shared span-returning tokenizer rather than adding a second, differently-capable scanner.

`packages/client/src/client.ts:31-38, 214-227` — the facade forwards unknown options and returns the core result verbatim, which is why no client source change is needed:

```ts
export type AskOverrides = Omit<
  AskPipelineOptions, "question" | "schema" | "model" | "dialect"
> & { schema?: SchemaSource | AnyNormalizedSchema; model?: AskDbLanguageModel; dialect?: AskDialectInput };

async ask(question, overrides = {}) {
  const { schema: schemaOverride, model: modelOverride, dialect: dialectOverride, deps, ...rest } = overrides;
  // ...
  return ask({ ...rest, question, schema, model: resolvedModel.model, dialect: dialect.dialect, ... });
}
```

### Conventions to match

- Public types live next to the implementation that owns them and are re-exported from the package `src/index.ts` barrel (and `src/sql/index.ts` for SQL helpers). Match `ask.ts` and `tenant-placeholders.ts`; do not add a global `types.ts`.
- Typed errors are `AskDbError` subclasses carrying a machine-readable reason union — see `packages/core/src/errors.ts:20-58` (`SqlValidationError`, `TenantScopeError`). Match that shape.
- Pure SQL helpers get focused colocated Vitest files under `packages/core/src/sql/`. Prompt-capture tests use a `vi.fn()` `generateText` spy and assert on `generateText.mock.calls[0][0].prompt` — see `packages/core/src/sql/generate.test.ts:28-70` as the exemplar.
- Structured log events are added to the `AskDbLogEvent` const object with a JSDoc line (`packages/core/src/logging/log-events.ts:5-38`). Log counts, never values.
- Package scripts are `build`, `lint` (`tsc --noEmit`), and `test` (Vitest).
- Public package changes require a Changesets note; core/client additions are minor releases while pre-1.0.
- Commit messages use conventional prefixes, e.g. `feat(core): ...`, `test(core): ...`, `docs: ...`.

### Verification baseline

No test baseline was established when this plan was written (the planning run was read-only). The executor must run `pnpm install --frozen-lockfile` and establish the baseline in Step 1 before editing. A pre-existing failure is a STOP condition, not something to absorb into this feature.

## Target public contract (do not redesign during implementation)

### Input

One new option. Nothing else about the input changes — the question text is **not** rewritten, and values are **not** stripped from it.

```ts
export type AskPipelineOptions = {
  // ... all existing fields unchanged ...
  /**
   * When true, ask the model to also return the SQL in unbound form plus a
   * JSON manifest of the values it parameterized. Populates `unboundSql`,
   * `params`, `parameters`, and `preparedQuery` on the result.
   * Default false — existing behavior is byte-identical.
   */
  parameterize?: boolean;
};
```

### Model output contract

When `parameterize` is true, the prompt asks for two fenced blocks: the SQL in unbound named-placeholder form, then a JSON manifest.

````text
```sql
SELECT SUM(total) FROM orders
WHERE order_date >= :start_date AND order_date < :end_date AND status = ANY(:statuses)
```
```json
{"parameters":[
  {"name":"start_date","type":"date","cardinality":"one","description":"Start of the reporting window","value":"2026-07-01"},
  {"name":"end_date","type":"date","cardinality":"one","description":"End of the reporting window","value":"2026-08-01"},
  {"name":"statuses","type":"string","cardinality":"many","description":"Order statuses to include","value":["paid","shipped"]}
]}
```
````

Rules the implementation enforces:

- Placeholder names match `^[a-z][a-z0-9_]*$`. The `tenant_` and `askdb_` prefixes are reserved and rejected in a manifest.
- The model emits `:name` placeholders only. **It never emits `$1`, `?`, or `@p0`** — AskDB allocates markers, because the model cannot know that tenant placeholders share the same counter.
- Types are `"string" | "number" | "boolean" | "date" | "datetime"`. Dates/datetimes are ISO strings; core validates shape and leaves database type coercion to the driver.
- `cardinality: "many"` requires a non-empty array; `"one"` rejects arrays. Null/undefined, non-finite numbers, `Date` objects, nested objects, and mixed-type arrays are rejected.
- Tenant placeholders (`:tenant_*`) must **not** appear in the manifest. They are bound from `tenantScope` as they are today.

### Graceful degradation (this is load-bearing)

Model output is not deterministic, so the four cases are resolved explicitly:

| SQL has `:name` placeholders | JSON manifest present | Outcome |
| --- | --- | --- |
| no | no | Plain result — exactly today's shape. No error. |
| no | yes, and empty `parameters` | Plain result. No error. |
| yes | yes, valid, consistent | Parameterized result. |
| yes | no, or invalid, or inconsistent | Throw `QueryParameterError` — the SQL cannot be executed with unresolved placeholders. |

A model that ignores the manifest instruction entirely still produces a working query. A model that half-complies fails loudly rather than returning SQL with live `:placeholders` in it.

### Result

Every new field is optional and absent unless `parameterize` is true **and** the model returned a non-empty manifest.

```ts
export type QueryParameterType = "string" | "number" | "boolean" | "date" | "datetime";
export type QueryParameterValue = string | number | boolean;

/** One parameter as bound for this call — enough to render a form field. */
export type QueryParameterBinding = {
  name: string;                    // "start_date"        → form field id
  placeholder: string;             // ":start_date"       → position in preparedQuery.namedSql
  type: QueryParameterType;        // "date"              → form input type
  cardinality: "one" | "many";
  description?: string;            // model-supplied      → form label / help text
  value: QueryParameterValue | QueryParameterValue[];
  /** Execution markers this parameter filled, in order: ["$1"] | ["?","?"] | ["@p0"]. */
  markers: string[];
  /** 0-based indices into `params` this parameter occupies, in order. */
  indices: number[];
  source: "question" | "tenant";
};

/** Serializable input to bindPreparedQuery(). Contains definitions, never values. */
export type PreparedQuery = {
  version: 1;
  dialect: BuiltInDialectId;
  /** SQL with `:name` / `:tenant_*` placeholders intact. */
  namedSql: string;
  parameters: Array<{
    name: string;
    placeholder: string;
    type: QueryParameterType;
    cardinality: "one" | "many";
    description?: string;
    source: "question" | "tenant";
  }>;
};

export type BoundQuery = {
  sql: string;
  params: QueryParameterValue[];
  bindings: QueryParameterBinding[];
};

export type AskPipelineResult = {
  sql: string;                          // bound — unchanged meaning
  /** Executable with `params`. Same as `sql` minus the bound values. */
  unboundSql?: string;
  params?: QueryParameterValue[];
  parameters?: QueryParameterBinding[];
  preparedQuery?: PreparedQuery;
  // ... all existing fields (explain, tenantGuardrail, tenantParams, tenantBindings, usage) unchanged ...
};
```

`parameters[].value` **does** carry the runtime value — the host needs it to pre-fill the form. `preparedQuery` does **not**: it is definitions and template SQL only.

### Local rebind utility

```ts
export function bindPreparedQuery(
  prepared: PreparedQuery,
  values: Record<string, QueryParameterValue | readonly QueryParameterValue[]>,
): BoundQuery;
```

Pure and synchronous. **`ask()` calls this exact function** to produce its own first binding — one code path, exercised on every parameterized ask.

It must **not** take a schema, compute fingerprints, validate a `TenantScope` shape, re-run tenant guardrails, or police reuse. Its guarantees are mechanical only:

- every placeholder in `prepared.namedSql` receives a value, or it throws `MISSING_VALUE`;
- no placeholder survives in the output, or it throws `UNRESOLVED_PLACEHOLDER`;
- values are type/cardinality-checked against the declarations;
- output re-passes `validateSelectSql` for `prepared.dialect`.

Tenant placeholders are bound by name here just like business ones (`":tenant_agency_ids"` takes an array of IDs). **Authorization remains the host's**, exactly as it is today when the host constructs `tenantScope` — document this explicitly (Step 8).

### Dialect marker rules

Add one optional field to `DialectSpec`:

```ts
/** How list-valued placeholders bind. Default "expand" when absent. */
listBinding?: "array" | "expand";
```

| Dialect | Scalar marker | `listBinding` | List form in SQL |
| --- | --- | --- | --- |
| `postgres`, `cockroachdb` | `$1`, `$2`, … | `"array"` | `= ANY($1)` — one marker, one array value; arity-stable |
| `mysql`, `mariadb`, `sqlite` | `?` | `"expand"` | `IN (?, ?, ?)` — one marker per element |
| `sqlserver` | `@p0`, `@p1`, … | `"expand"` | `IN (@p3, @p4, @p5)` |

Only Postgres/CockroachDB have a real array parameter type, so only they get the arity-stable form. Everywhere else the marker count tracks the list length — which is precisely why `bindPreparedQuery()` exists rather than expecting hosts to hand-edit the params array.

Scalar placeholders allocate one marker per **occurrence**, even when repeated, because `?` dialects have no other option and it keeps the audit list deterministic.

Note the SQL Server off-by-one: markers are `@p0`-based while `indices` is 0-based and `markers` is per-parameter — hosts map values via `parameters[].markers`, never by computing marker names themselves.

Reusable parameterization requires a built-in dialect ID or a `DialectSpec` whose `id` is built-in. `parameterize: true` with a custom `AskDialect` throws `DIALECT_UNSUPPORTED` **before the model call** — do not guess a driver's marker convention. Ordinary (non-parameterized) custom `AskDialect` calls are unaffected.

### Output-mode interaction

- Business parameters are always bound as markers. `sql-only` literal inlining is **not** supported for them: it would concatenate model-extracted values into SQL text, and the existing literal escaper (`tenant-placeholders.ts:116-118`) only doubles single quotes, which is insufficient on MySQL/MariaDB where backslash escapes are enabled by default. Do not extend that escaper in this plan.
- `tenantSqlMode` keeps its current meaning and its `"sql-only"` default. When it is `"sql-only"`, tenant IDs are still inlined as literals exactly as today and contribute no markers.
- When `tenantSqlMode` is `"sql-params"`, business markers are allocated first (1..N) and tenant markers continue from N+1 via the existing `paramStartIndex` argument of `resolveTenantSql` (`tenant-placeholders.ts:204-241`).
- `result.params` is the full ordered array. `tenantParams` and `tenantBindings` keep their current tenant-only meaning; document that a caller using `parameterize` must execute with `params`, not `tenantParams`.

### Errors

```ts
export type QueryParameterRejectionReason =
  | "MANIFEST_MISSING"
  | "MANIFEST_INVALID"
  | "INVALID_NAME"
  | "RESERVED_NAME"
  | "INVALID_VALUE"
  | "MISSING_VALUE"
  | "UNDECLARED_PLACEHOLDER"
  | "MISSING_PLACEHOLDER"
  | "INVALID_LIST_CONTEXT"
  | "UNRESOLVED_PLACEHOLDER"
  | "DIALECT_UNSUPPORTED";

export class QueryParameterError extends AskDbError {
  constructor(message: string, public readonly reason: QueryParameterRejectionReason) {
    super(message);
    this.name = "QueryParameterError";
  }
}
```

Messages must be actionable and must never include a parameter value.

## Commands you will need

| Purpose | Command | Expected on success |
| --- | --- | --- |
| Install | `pnpm install --frozen-lockfile` | exit 0; lockfile unchanged |
| Core tests | `pnpm --filter @askdb/core test` | exit 0; all core tests pass |
| Client tests | `pnpm --filter @askdb/client test` | exit 0; all client tests pass |
| Core typecheck | `pnpm --filter @askdb/core lint` | exit 0; no TypeScript errors |
| Client typecheck | `pnpm --filter @askdb/client lint` | exit 0; no TypeScript errors |
| Full test suite | `pnpm test` | exit 0; all workspace tests pass |
| Full typecheck | `pnpm lint` | exit 0 |
| Docs build | `pnpm docs:build` | exit 0; Astro/Starlight build succeeds |
| Installable package check | `pnpm smoke:install` | exit 0 |
| Release preflight | `pnpm preflight` | exit 0 |

## Scope

**In scope** (the only source/docs files that should be modified):

- `packages/core/src/ask.ts`
- `packages/core/src/errors.ts`
- `packages/core/src/index.ts`
- `packages/core/src/sql/index.ts`
- `packages/core/src/sql/bind.ts` (create — shared scanner, marker allocation, `bindPreparedQuery`)
- `packages/core/src/sql/parameter-manifest.ts` (create — manifest types, parsing, validation)
- `packages/core/src/sql/dialect-spec.ts`
- `packages/core/src/sql/extract-sql.ts`
- `packages/core/src/sql/generate.ts`
- `packages/core/src/sql/prompt.ts`
- `packages/core/src/sql/tenant-placeholders.ts` (reimplement over the shared binder; public signatures and behavior preserved)
- `packages/core/src/sql/validate.ts` (extract the shared tokenizer only; guardrail behavior unchanged)
- `packages/core/src/logging/log-events.ts`
- Focused tests under `packages/core/src/`: create `bind.test.ts` and `parameter-manifest.test.ts`; extend `extract-sql`, `generate.test.ts`, `ask.test.ts` where their contract is directly affected
- `packages/client/src/client.test.ts` (passthrough assertion only — no `client.ts` change)
- `packages/client/src/client.smoke.test.ts`
- `packages/core/README.md`, `packages/client/README.md`
- `docs/specs/core-pipeline.md`, `docs/specs/multi-tenancy.md`, `docs/contracts/tenant-policy.md`
- `apps/docs-site/src/content/docs/reference/core-api.mdx`, `.../reference/client-api.mdx`, `.../guides/embed-in-node.mdx`, `.../guides/multi-tenancy.mdx`
- one new `.changeset/*.md`
- `plans/README.md` (status only)

**Out of scope** (do not touch, even though related):

- `packages/client/src/client.ts` — the facade already forwards options and returns the core result verbatim. If you believe a change is needed here, that is a STOP condition.
- `apps/studio/**` — a visual parameter editor is a follow-up once this contract exists. Existing Studio tests must still pass unchanged.
- `apps/http-api/**` — do not accept caller-supplied prepared SQL over a network boundary.
- `apps/cli/**` — the one-shot CLI does not benefit from a parameter manifest.
- `tenant-prompt.ts` tenant placeholder instructions and the `=` → `IN` tolerance in `replaceOperatorAware` — preserving these is what keeps tenant behavior unchanged.
- The `escapeSqlLiteral` MySQL backslash weakness noted above. Real, pre-existing, separately tracked; widening or "fixing" it here expands the diff and the risk.
- Any built-in cache, cache key, TTL, persistence, encryption, or signing mechanism.
- Fingerprints, schema-drift detection, or tenant access-shape comparison at bind time.
- Host-declared `{{token}}` parameters.
- SQL AST/parser dependencies.
- Database execution — AskDB returns SQL + params; the host executes.

## Git workflow

- Keep the current branch name unless the operator directs otherwise.
- Suggested commits: `feat(core): add shared SQL parameter binder`, `feat(core): return unbound SQL and parameter manifest from ask()`, `docs: document parameterized ask output`.
- Add one changeset with a minor bump for `@askdb/core`. The root Changesets config links core with the CLI/HTTP release train; let Changesets calculate linked consequences rather than hand-editing versions.
- Do not push or open a PR unless the operator explicitly requests it.

## Steps

### Step 1: Establish the baseline

Run `pnpm install --frozen-lockfile`, then `pnpm --filter @askdb/core test`, `pnpm --filter @askdb/client test`, `pnpm --filter @askdb/core lint`, and `pnpm --filter @askdb/client lint`. Record the test counts in your handoff notes — you will compare against them at the end.

**Verify**: all four commands exit 0. If any fails before you have edited anything, STOP and report.

### Step 2: Add the dialect list-binding capability and harden SQL extraction

In `dialect-spec.ts`, add the optional `listBinding?: "array" | "expand"` field to `DialectSpec` with the JSDoc from "Dialect marker rules". Set `"array"` on `POSTGRES_DIALECT` (CockroachDB inherits it by spread) and `"expand"` on `MYSQL_DIALECT`, `SQLITE_DIALECT`, and `SQLSERVER_DIALECT` (MariaDB inherits from MySQL). Absent must be treated as `"expand"` by consumers so third-party specs keep working.

In `extract-sql.ts`, make the extractor prefer an explicitly `sql`-tagged fence before falling back to an untagged one. The current regex treats the language tag as optional and will return a ```json block if it appears first (`extract-sql.ts:6`). Keep the existing single-block and bare-prose behaviors identical.

Add a sibling `extract-sql.test.ts` case (or extend the existing coverage) proving that a reply containing a ```json block followed by a ```sql block returns the SQL, and that a reply with only an untagged fence still returns its contents.

**Verify**: `pnpm --filter @askdb/core test -- extract-sql dialect-spec` → all pass, including the new cases.

### Step 3: Build the shared binder and reimplement the tenant path over it

Create `packages/core/src/sql/bind.ts` containing:

1. **A span-returning SQL tokenizer.** Extract the quote-state logic already in `validate.ts:110-153` (`stripSqlStringLiterals`) into a shared function that returns the offsets of code regions vs. quoted regions, and extend it to also recognize MySQL backticks and SQL Server brackets. Have `validateSelectSql` consume the shared function so there is exactly one quote-state machine in the codebase. `validateSelectSql`'s observable behavior must not change.
2. **A placeholder scanner** that finds `:name` and `:tenant_*_ids` tokens **only outside** quoted regions, returning `{ name, start, end }` occurrences in source order.
3. **List-context validation** — a `many` placeholder must be the sole expression inside `IN (...)` / `NOT IN (...)` (expand dialects) or the sole argument of `= ANY(...)` (array dialects).
4. **Marker allocation and substitution**, replacing occurrences right-to-left so offsets stay valid, while emitting `params` in left-to-right occurrence order.
5. **`bindPreparedQuery(prepared, values)`** with the signature and guarantees from "Local rebind utility".

Then reimplement `tenant-placeholders.ts` over these primitives. **Every exported signature and every observable behavior stays the same**, including `resolveTenantSql`'s `paramStartIndex`, the `sql-only` literal path, and the `=` → `IN` rewriting in `replaceOperatorAware`. This step is behavior-preserving refactoring plus new capability; the entire existing `tenant-placeholders.test.ts` suite must pass untouched.

Create `bind.test.ts` covering the pure binder: scalar and list binding per dialect, repeated scalars, right-to-left substitution correctness, placeholder-looking text inside every supported quote form left untouched, `MISSING_VALUE` / `UNRESOLVED_PLACEHOLDER` / `INVALID_LIST_CONTEXT` rejections, and Postgres `$1` markers surviving `validateSelectSql` re-validation (its dollar-quote branch must not mistake `$1` for a dollar-quoted string).

**Verify**: `pnpm --filter @askdb/core test -- bind tenant-placeholders validate` → all pass, and `tenant-placeholders.test.ts` passes with **zero edits to that file**. If you need to edit it, STOP — the refactor changed behavior.

### Step 4: Add manifest types, parsing, and validation

Create `packages/core/src/sql/parameter-manifest.ts` with the public parameter types, a Zod schema for the manifest (the repo already uses Zod — see `packages/core/src/schema/v2/tenant-policy.ts`), and a `parseParameterManifest(modelText)` that extracts the ```json fence and validates it.

Cross-validation against the SQL, all before any binding:

- every manifest parameter appears at least once as a placeholder in the SQL (`MISSING_PLACEHOLDER`);
- no non-tenant placeholder in the SQL is absent from the manifest (`UNDECLARED_PLACEHOLDER`);
- names match `^[a-z][a-z0-9_]*$` (`INVALID_NAME`) and use neither the `tenant_` nor `askdb_` prefix (`RESERVED_NAME`);
- values match their declared type and cardinality (`INVALID_VALUE`);
- list placeholders sit in valid list context (`INVALID_LIST_CONTEXT`).

Add `QueryParameterError` and `QueryParameterRejectionReason` to `errors.ts`, matching the `TenantScopeError` shape at `errors.ts:44-58`.

Create `parameter-manifest.test.ts` covering: valid manifest; missing manifest with placeholders present → `MANIFEST_MISSING`; malformed JSON → `MANIFEST_INVALID`; each rejection reason above; empty array → treated as "no parameters" rather than an error; and a manifest that tries to declare a `:tenant_*` placeholder → `RESERVED_NAME`.

**Verify**: `pnpm --filter @askdb/core test -- parameter-manifest` → all pass.

### Step 5: Teach the prompt and generator the parameterize path

Thread a `parameterize?: boolean` flag through `AskDialectGenerateOptions` (`ask.ts:27-35`) and `GenerateSqlDeps` (`generate.ts:20-41`) into `buildNlToSqlUserPrompt()`.

When it is true, append an output-format block after the existing rules that instructs the model to: emit the SQL with `:name` placeholders substituted for values taken from the question; never emit `$1`/`?`/`@p0`; use `IN (:name)` for multi-value placeholders on expand dialects or `= ANY(:name)` on array dialects (branch on `dialect.listBinding`); leave `:tenant_*` placeholders exactly as the tenant policy block already instructs; and follow the SQL block with a ```json manifest of `{name, type, cardinality, description, value}`. Instruct it to parameterize only values that came from the user's question — not structural constants it chose itself.

**When `parameterize` is false the prompt must be byte-for-byte identical to today.** Assert this with a snapshot-style test comparing the prompt built with the flag absent against the current output.

In `generate.ts`, when the flag is on: extract the SQL, run `validateSelectSql`, parse and cross-validate the manifest, then run `validateTenantGuardrails` **against the named (unbound) SQL** — same as today, since tenant placeholders are still present at that point. Return the named SQL plus the validated manifest on `GenerateSelectSqlResult`; binding happens in `ask()`.

Add `PipelineParameterized: "askdb.pipeline.parameterized"` to `AskDbLogEvent` and emit it with **counts only** (`parameterCount`, `listParameterCount`) — never names or values.

**Verify**: `pnpm --filter @askdb/core test -- generate prompt tenant-guardrail` → all pass; the prompt-identity test proves the no-flag prompt is unchanged, and a parameterize-on test proves the manifest instruction is present.

### Step 6: Integrate binding into `ask()`

In `ask.ts`:

1. Add `parameterize?: boolean` to `AskPipelineOptions` and the new result fields to `AskPipelineResult`.
2. When `parameterize` is true and the resolved dialect is a custom `AskDialect`, throw `QueryParameterError` with `DIALECT_UNSUPPORTED` **before** any model call.
3. Forward the flag into `dialect.generate`.
4. When a validated manifest came back, build the `PreparedQuery` from the named SQL, dialect ID, and parameter definitions, then call `bindPreparedQuery()` with the manifest values to produce the bound SQL, params, and bindings.
5. Bind tenant placeholders after business ones, passing `businessParams.length + 1` as `resolveTenantSql`'s `paramStartIndex` when `tenantSqlMode` is `"sql-params"`. When it is `"sql-only"` (the default) the tenant path is unchanged and contributes no markers.
6. Populate `sql`, `unboundSql`, `params`, `parameters`, and `preparedQuery`, leaving every existing field's behavior intact.
7. Re-run `validateSelectSql` on the final bound SQL.

Export `bindPreparedQuery`, `QueryParameterError`, and all new public types from `packages/core/src/sql/index.ts` and `packages/core/src/index.ts`, matching the existing export-block style at `index.ts:8-25`.

Extend `ask.test.ts` with: a no-flag call returning a result object deep-equal to today's; a parameterized call returning all four new fields; a combined business + tenant call in both tenant modes asserting marker ordering and that `tenantParams` still holds only tenant values; and the custom-`AskDialect` rejection firing with `generateText` never called.

**Verify**: `pnpm --filter @askdb/core test && pnpm --filter @askdb/core lint` → exit 0.

### Step 7: Prove the client forwards it without a source change

Do **not** edit `packages/client/src/client.ts`. Add a test to `client.test.ts` that calls `askdb.ask(question, { parameterize: true, deps: { generateText: spy } })` with a spy returning a two-block reply, and asserts the new result fields arrive intact through the facade. Extend `client.smoke.test.ts` so a TypeScript consumer can import `PreparedQuery`, `BoundQuery`, `QueryParameterBinding`, and `bindPreparedQuery` through the documented public barrels and call the binder.

**Verify**: `pnpm --filter @askdb/client test && pnpm --filter @askdb/client lint` → exit 0, and `git status --short packages/client/src/client.ts` shows no modification.

### Step 8: Document the contract and the trust boundary

Update the package READMEs, the three internal specs, and the four docs-site pages in scope. Use one consistent example:

```ts
const result = await askdb.ask(
  "Total revenue between July 1 2026 and August 1 2026 for paid and shipped orders",
  { parameterize: true, tenantScope },
);

// Execute either form.
await pool.query(result.sql);                       // bound
await pool.query(result.unboundSql!, result.params); // unbound + params

// Render a form from result.parameters, then rebind locally — no model call.
const rebound = bindPreparedQuery(result.preparedQuery!, {
  start_date: "2026-07-08",
  end_date: "2026-07-15",
  statuses: ["paid"],
  ":tenant_agency_ids": authorizedAgencyIds,
});
await pool.query(rebound.sql, rebound.params);
```

Docs must state plainly:

- every `ask()` is exactly one model call; `parameterize` does not add or remove one, and nothing here lets a caller skip it;
- the question is sent to the model unchanged, values included — this is not a redaction feature;
- the model decides what to parameterize, so a mistake changes the *form*, not the query: the bound SQL is correct either way;
- a value the model bound to one column may not suit a different value the user types into that field (a code column vs. a name column) — hosts should constrain form inputs using the returned `type` and `description`;
- `bindPreparedQuery()` is mechanical: it checks names, types, and cardinality, and **does not authorize tenant IDs**. Authorization is the host's responsibility, exactly as it is today when the host builds `tenantScope`;
- callers using `parameterize` must execute with `params`, not `tenantParams`;
- list parameters are arity-stable only on PostgreSQL/CockroachDB (`= ANY($n)`); elsewhere a changed list length changes the marker count, so rebind through `bindPreparedQuery()` rather than swapping the array;
- driver examples for PostgreSQL/MySQL/SQLite/SQL Server use the marker style actually returned, and map values via `parameters[].markers` for SQL Server.

**Verify**: `pnpm docs:build` → exit 0, no broken links or MDX errors.

### Step 9: Release metadata and full gates

Add one changeset with a minor bump for `@askdb/core`, describing the additive `parameterize` option, the new result fields, `bindPreparedQuery`, `DialectSpec.listBinding`, and the unchanged-by-default guarantee. Follow the prose style of `.changeset/032-unify-studio-execute.md`.

**Verify**:

```bash
pnpm test
pnpm lint
pnpm docs:build
pnpm smoke:install
pnpm preflight
git diff --check
```

All exit 0. `git status --short` lists only files permitted by Scope (plus `plans/README.md`).

## Test plan

Structural exemplars: `packages/core/src/sql/generate.test.ts:28-70` for `generateText` spy + prompt capture; `packages/core/src/sql/tenant-placeholders.test.ts` for pure-function coverage; `packages/core/src/sql/tenant-consumer-smoke.test.ts` for external-consumer behavior; `packages/client/src/client.test.ts` for resolution/call-count spies.

Required cases:

- Scalar binding for each type (string, number, boolean, date, datetime).
- List binding with 1 and N values; empty list rejected.
- `$1`, `?`, `@p0` markers emitted for the right dialects; `= ANY($1)` on Postgres and `IN (?, ?)` on MySQL/SQLite.
- Repeated scalar placeholder allocates one marker per occurrence in source order.
- Placeholder-looking text inside single quotes, double quotes, backticks, brackets, and dollar-quoted strings is left untouched.
- All four graceful-degradation rows from the table above.
- Each `QueryParameterRejectionReason` fires from the condition that should produce it.
- Combined business + tenant in `tenantSqlMode: "sql-only"` (tenant literals, business markers) and `"sql-params"` (continuous marker sequence).
- `tenantParams` and `tenantBindings` keep tenant-only contents in both modes.
- `parameterize: false` (and omitted) produces a result deep-equal to today's and a byte-identical prompt.
- Custom `AskDialect` + `parameterize: true` throws `DIALECT_UNSUPPORTED` with `generateText` never called; ordinary custom-dialect calls stay green.
- `bindPreparedQuery()` round-trips a JSON-serialized `PreparedQuery` and calls no model, retriever, or schema loader.
- The whole existing `tenant-placeholders.test.ts` passes unedited.

## Done criteria

ALL must hold:

- [ ] `ask({ parameterize: true })` returns `sql`, `unboundSql`, `params`, `parameters`, and `preparedQuery` after exactly one model call.
- [ ] `ask()` without `parameterize` returns a result deep-equal to today's, from a byte-identical prompt.
- [ ] `bindPreparedQuery()` is exported, pure, synchronous, and is the same function `ask()` uses internally.
- [ ] Business and tenant placeholders bind through one shared scanner and marker allocator; `tenant-placeholders.test.ts` passes with zero edits.
- [ ] `preparedQuery` contains no runtime values; `parameters[].value` does, by design.
- [ ] Placeholder scanning ignores placeholder-looking text in all five quote forms, and `validateSelectSql` uses the same tokenizer.
- [ ] Markers are dialect-correct, with `= ANY($n)` only on Postgres/CockroachDB.
- [ ] All four graceful-degradation cases behave as tabulated.
- [ ] `parameterize: true` with a custom `AskDialect` throws before the model call.
- [ ] `packages/client/src/client.ts` is unmodified and the facade forwards the option and result.
- [ ] READMEs, specs, and docs-site pages describe the implemented API, the one-model-call rule, and the authorization boundary.
- [ ] A changeset covers the `@askdb/core` minor.
- [ ] `pnpm test`, `pnpm lint`, `pnpm docs:build`, `pnpm smoke:install`, `pnpm preflight`, `git diff --check` all exit 0.
- [ ] No files outside the in-scope list are modified.
- [ ] `plans/README.md` marks plan 033 DONE (unless maintained by a reviewer).

## STOP conditions

Stop and report back; do not improvise if:

- Any "Current state" excerpt has materially drifted from commit `c81bb4e`, especially the public `ask()` types or tenant placeholder semantics.
- Baseline tests or typechecks fail before your first edit.
- Making `tenant-placeholders.test.ts` pass requires editing it. The refactor must be behavior-preserving.
- `packages/client/src/client.ts` appears to need a change.
- Making the no-flag prompt identical to today's proves impossible.
- Correctness seems to require sending a modified question, stripping values from the question, or rewriting the question with tokens. That is a different design and needs a decision, not an improvisation.
- Tenant guardrails can only be made to pass by validating bound SQL instead of the named template.
- A list placeholder cannot be proven to sit in valid list context and the temptation is to add operator-aware rewriting at bind time. Reject the model output instead.
- Supporting `parameterize` for a custom `AskDialect` requires guessing a marker convention.
- Any error message or log line would have to contain a parameter value.
- Any verification step fails twice after a reasonable correction.

## Maintenance notes

- `PreparedQuery.version` is a serialization contract. Add a V2 with a migration path for shape changes; never reinterpret stored V1 artifacts.
- **Deliberately deferred: flipping `parameterize` to default `true`.** Do that only once the manifest path has real-world mileage across providers, and treat it as a minor with its own changeset and prompt-regression testing.
- **Deliberately deferred: host-declared `{{token}}` parameters.** Model-supplied extraction was chosen because it needs no new host syntax and works on free-text questions. If a host later needs deterministic, auditable parameter names, an explicit declaration mode can be added *alongside* this one — it does not replace it.
- `escapeSqlLiteral` (`tenant-placeholders.ts:116-118`) doubles single quotes only, which is insufficient on MySQL/MariaDB where backslash escapes are enabled by default. It is deliberately untouched here and reaches only host-supplied tenant IDs today. Fix it in its own plan; do not let business values reach it.
- `mentionsIdentifier` (`tenant-guardrail.ts:190-193`) wraps patterns in `\b`, so its placeholder checks at `:96` and `:113` never match real SQL (`\b:` requires a word character immediately before the colon). Only the column-name checks are load-bearing today. Out of scope here; worth its own small plan.
- A future Studio plan can build a parameter editor directly from `result.parameters` and call `bindPreparedQuery()` locally, re-executing without another token-usage event.
- If an HTTP bind surface is ever added, store prepared queries server-side behind opaque, user-owned IDs with bounded TTL/LRU. Do not trust an artifact posted by a client merely because it passes SELECT validation.
- Reviewers should scrutinize: quote-state scanning, list-context validation, marker ordering across the business→tenant boundary, the four degradation cases, and every path where a parameter value could reach a log line or an error message.
