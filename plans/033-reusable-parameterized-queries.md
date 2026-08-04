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
- **Category**: direction + dx + security
- **Planned at**: commit `c81bb4e`, 2026-08-04

## Why this matters

Today `ask()` returns one thing: a bound SQL string with the question's values baked in as literals. A host that wants to let a user tweak a value — a date range, a threshold, a status list — has no machine-readable description of which values in that SQL came from the question, so it cannot build a form around the query.

This plan changes what comes *back* from the model, not what goes in. The question is still sent exactly as it is today, values inline. The model additionally returns the same SQL in unbound form plus a small JSON manifest naming each value it parameterized. `ask()` then returns **the bound SQL exactly as today, plus `unboundSql`, `params`, and per-parameter metadata** a host can render a dynamic form from.

Re-binding after a form edit is the host's business, but AskDB exposes the same binder it uses internally as `bindPreparedQuery()` so hosts do not have to re-implement value escaping or marker rules. That binder is shared with the existing tenant placeholder path, so business values and tenant IDs go through one scanner, one escaper, and one occurrence ordering.

**This is not a cache and not a second pipeline.** Every `ask()` still makes exactly one model call. Nothing here lets a caller skip the model.

## Assumptions this plan makes

These were settled in design review. If any turns out to be unworkable, that is a STOP condition, not something to reinterpret.

1. **`parameterize` defaults to `true`, with an opt-out.** The flag exists so cost-sensitive hosts can turn the feature off, not so hosts must turn it on.
2. **Existing behavior can never get worse.** The model returns the bound SQL directly, so `result.sql` is what it is today. If the unbound block or manifest is missing, malformed, or inconsistent, AskDB **drops the extra fields and returns today's result**. No new error reaches a caller who did not ask for this feature.
3. **The model decides what to parameterize.** No `{{token}}` syntax for hosts to declare parameters, and no post-hoc extraction of literals from model output. Host-declared parameters were considered and deliberately deferred (see "Maintenance notes").
4. **Binding is string substitution performed before execution.** See "The two execution paths" — this is the decision that determines the escaping requirements below.

## The two execution paths (read this before implementing anything)

"Binding" means two different things, and this plan supports both from one artifact:

- **Substitution (primary).** `bindPreparedQuery()` replaces each placeholder in the SQL text with a properly escaped literal, producing a complete, ready-to-run statement. The database only ever receives finished SQL.
- **Driver binding (secondary).** The host passes `unboundSql` and `params` to its driver, which sends the markers and the values separately over the wire.

Two consequences follow, and both are load-bearing:

**Markers are never quoted in the SQL.** The template must read `WHERE state = :state_name`, never `WHERE state = ':state_name'`. The binder supplies the surrounding quotes as part of escaping the value. A quoted marker would mean substituting a raw value inside existing quotes, so any value containing an apostrophe (`O'Brien`) escapes its string context — a SQL injection. The placeholder scanner in Step 3 only recognizes placeholders **outside** quoted regions, so a quoted marker is automatically invisible to it, fails the "every manifest parameter appears in the SQL" check, and causes the extras to be dropped. That is the desired fail-safe, and it must be tested explicitly.

**The literal escaper becomes security-critical and must be fixed in this plan.** `escapeSqlLiteral` (`tenant-placeholders.ts:116-118`) doubles single quotes only. That is insufficient on MySQL/MariaDB, where backslash escapes are enabled by default: a value ending in `\` consumes its own closing quote and the remainder of the statement becomes string content. Today that function only ever sees host-controlled tenant IDs. Under this plan it sees whatever a user typed into a form field, so Step 4 makes it dialect-aware. This is **in scope and mandatory**, not a follow-up.

Note also that no cast-form rule is needed. Because substitution happens before execution, a model-written `DATE :start_date` becomes `DATE '2026-07-01'` — an ordinary typed literal. (The restriction that `DATE $1` is invalid applies only to driver binding, where the marker is still present at parse time. Hosts using the driver path get `unboundSql` with plain markers and no typed-literal wrapper, because the model writes the cast around the *value* in the bound form, not around the marker.)

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
- `packages/core/src/sql/tenant-prompt.ts` — tenant policy prompt block, including `:tenant_*` placeholder instructions.
- `packages/core/src/sql/tenant-placeholders.ts` — tenant-only regex extraction, literal replacement (**contains the escaper this plan must fix**), and `$N` parameter replacement.
- `packages/core/src/sql/tenant-guardrail.ts` — validates tenant predicate shape against named-template SQL.
- `packages/core/src/sql/validate.ts` — read-only SELECT guardrail; contains an existing SQL string-literal stripper.
- `packages/core/src/sql/dialect-spec.ts` — built-in dialect specs; currently describes no marker or escaping style.
- `packages/core/src/errors.ts` — typed `AskDbError` subclasses with machine-readable reason unions.
- `packages/core/src/logging/log-events.ts` — stable structured-log event names.
- `packages/core/src/index.ts` and `packages/core/src/sql/index.ts` — public barrels.
- `packages/client/src/client.ts` — config-aware facade. **Requires no source change** (see Step 8).

### Current public API excerpts

`packages/core/src/ask.ts:147-155` — the result today:

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

`packages/core/src/ask.ts:206-214` — tenant binding after generation. `resolveTenantSql` already accepts a start index (`tenant-placeholders.ts:204-241`), which this plan uses to keep business and tenant markers in one sequence:

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

`packages/core/src/sql/tenant-placeholders.ts:116-135` — **the escaper this plan must fix**, plus its only current caller. Note it takes no dialect:

```ts
function escapeSqlLiteral(value: string): string {
  return "'" + value.replace(/'/g, "''") + "'";
}

export function replacePlaceholdersWithLiterals(sql: string, resolved: ResolvedPlaceholder[]): string {
  let result = sql;
  for (const r of resolved) {
    if (r.ids.length === 0) continue;
    const literal =
      r.ids.length === 1
        ? escapeSqlLiteral(r.ids[0]!)
        : `(${r.ids.map(escapeSqlLiteral).join(", ")})`;
    result = replaceOperatorAware(result, r.placeholder, literal, r.ids.length > 1);
  }
  return result;
}
```

`packages/core/src/sql/extract-sql.ts:4-11` — **the language tag is optional**, so with several fenced blocks in one reply this returns whichever comes first, regardless of language:

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

`packages/core/src/sql/tenant-placeholders.ts:34-50` — tenant scanning is a bare global regex, with no awareness of string literals or quoted identifiers:

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

`packages/core/src/sql/tenant-placeholders.ts:172-194` — operator-aware replacement rewrites `=` to `IN` for multi-ID scopes. **Preserve this exactly**; every existing tenant fixture emits the scalar `= :tenant_agency_ids` form (e.g. `tenant-ask-integration.test.ts:42`, `tenant-consumer-smoke.test.ts:72`, `tenant-guardrail.test.ts:26`).

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

- Public types live next to the implementation that owns them and are re-exported from `src/index.ts` (and `src/sql/index.ts` for SQL helpers). Match `ask.ts` and `tenant-placeholders.ts`; do not add a global `types.ts`.
- Typed errors are `AskDbError` subclasses carrying a machine-readable reason union — see `packages/core/src/errors.ts:20-58` (`SqlValidationError`, `TenantScopeError`).
- Pure SQL helpers get focused colocated Vitest files under `packages/core/src/sql/`. Prompt-capture tests use a `vi.fn()` `generateText` spy and assert on `generateText.mock.calls[0][0].prompt` — see `packages/core/src/sql/generate.test.ts:28-70` as the exemplar.
- Structured log events are added to the `AskDbLogEvent` const object with a JSDoc line (`packages/core/src/logging/log-events.ts:5-38`). Log counts, never values.
- Zod is already used for runtime validation — see `packages/core/src/schema/v2/tenant-policy.ts`.
- Package scripts are `build`, `lint` (`tsc --noEmit`), and `test` (Vitest).
- Public package changes require a Changesets note; core additions are minor releases while pre-1.0.
- Commit messages use conventional prefixes, e.g. `feat(core): ...`, `test(core): ...`, `docs: ...`.

### Verification baseline

No test baseline was established when this plan was written (the planning run was read-only). Establish it in Step 1 before editing. A pre-existing failure is a STOP condition, not something to absorb into this feature.

## Target public contract (do not redesign during implementation)

### Input

One new option; nothing else about the input changes. The question text is **not** rewritten and values are **not** stripped from it.

```ts
export type AskPipelineOptions = {
  // ... all existing fields unchanged ...
  /**
   * Ask the model to also return the SQL in unbound form plus a JSON manifest
   * of the values it parameterized, populating `unboundSql`, `params`,
   * `parameters`, and `preparedQuery`. Default true. Set false to save the
   * extra output tokens when the host does not use those fields.
   */
  parameterize?: boolean;
};
```

### Model output contract

Three fenced blocks: the bound SQL exactly as the model writes it today, the same statement in unbound form, then the manifest.

````text
```sql
SELECT count(*) FROM cities WHERE state = 'colorado'
```
```sql-unbound
SELECT count(*) FROM cities WHERE state = :state_name
```
```json
{"parameters":[{"name":"state_name","type":"string","cardinality":"one","description":"State to count cities for","value":"colorado"}]}
```
````

Rules the implementation enforces:

- Placeholder names match `^[a-z][a-z0-9_]*$`. The `tenant_` and `askdb_` prefixes are reserved and rejected in a manifest.
- **Placeholders are never wrapped in quotes.** `state = :state_name`, never `state = ':state_name'`.
- The model emits `:name` placeholders only. It never emits `$1`, `?`, or `@p0` — AskDB derives those, because the model cannot know that tenant placeholders share the same counter.
- Types are `"string" | "number" | "boolean" | "date" | "datetime"`. Dates/datetimes are ISO strings; core validates shape and leaves database type coercion to the driver.
- `cardinality: "many"` requires a non-empty array; `"one"` rejects arrays. Null/undefined, non-finite numbers, `Date` objects, nested objects, and mixed-type arrays are rejected.
- Tenant placeholders (`:tenant_*`) must **not** appear in the manifest. They stay in the unbound SQL and are bound from `tenantScope` as they are today.
- The two SQL blocks must be the same statement. AskDB verifies this by substituting the manifest values into the unbound block and comparing structurally against the bound block.

### Graceful degradation (this is load-bearing)

Model output is not deterministic, and the default is on, so **the extras are always optional and never fatal**:

| Condition | Outcome |
| --- | --- |
| No unbound block and no manifest | Plain result — exactly today's shape |
| Manifest present but `parameters` is empty | Plain result |
| Unbound block + valid manifest + blocks agree | Full parameterized result |
| Unbound block missing, malformed, or manifest invalid | **Drop the extras**, return the bound SQL. Log at debug. No throw |
| Blocks present but disagree after substitution | **Drop the extras**, return the bound SQL. Log at debug. No throw |

Because `result.sql` always comes from the model's bound block, a caller who never reads the new fields cannot be affected by any failure in this path. `QueryParameterError` is reachable only from `bindPreparedQuery()`, which a caller must invoke deliberately.

### Result

Every new field is optional and absent unless `parameterize` is on **and** the model returned a consistent unbound block and non-empty manifest.

```ts
export type QueryParameterType = "string" | "number" | "boolean" | "date" | "datetime";
export type QueryParameterValue = string | number | boolean;

/** One parameter as bound for this call — enough to render a form field. */
export type QueryParameterBinding = {
  name: string;                    // "state_name"        → form field id
  placeholder: string;             // ":state_name"       → position in preparedQuery.namedSql
  type: QueryParameterType;
  cardinality: "one" | "many";
  description?: string;            // model-supplied      → form label / help text
  value: QueryParameterValue | QueryParameterValue[];
  /** Driver markers this parameter fills in `unboundSql`, in order: ["$1"] | ["?","?"] | ["@p0"]. */
  markers: string[];
  /** 0-based indices into `params` this parameter occupies, in order. */
  indices: number[];
  source: "question" | "tenant";
};

/** Serializable input to bindPreparedQuery(). Definitions and template only — no values. */
export type PreparedQuery = {
  version: 1;
  dialect: BuiltInDialectId;
  /** SQL with unquoted `:name` / `:tenant_*` placeholders intact. */
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
  /** Ready to run as-is — every placeholder replaced with an escaped literal. */
  sql: string;
  /** Same statement with driver markers instead of literals. */
  unboundSql: string;
  params: QueryParameterValue[];
  bindings: QueryParameterBinding[];
};

export type AskPipelineResult = {
  sql: string;                          // the model's bound SQL — unchanged meaning
  unboundSql?: string;                  // driver markers; executable with `params`
  params?: QueryParameterValue[];       // positional — for drivers
  parameters?: QueryParameterBinding[]; // named — for form UIs
  preparedQuery?: PreparedQuery;
  // ... all existing fields (explain, tenantGuardrail, tenantParams, tenantBindings, usage) unchanged ...
};
```

`parameters[].value` **does** carry the runtime value — the host needs it to pre-fill the form. `preparedQuery` does **not**: it is definitions and template SQL only. Both the named map (`parameters`) and the positional array (`params`) are returned, because form UIs want stable keys and drivers want ordinals.

### Local rebind utility

```ts
export function bindPreparedQuery(
  prepared: PreparedQuery,
  values: Record<string, QueryParameterValue | readonly QueryParameterValue[]>,
): BoundQuery;
```

Pure and synchronous. **`ask()` calls this exact function** for its own consistency check, so it is exercised on every parameterized ask rather than only in host tests.

It returns both forms so either execution path works off one call: `sql` is ready to run; `unboundSql` + `params` suit a driver.

It must **not** take a schema, compute fingerprints, validate a `TenantScope` shape, re-run tenant guardrails, or police reuse. Its guarantees are mechanical only:

- every placeholder in `prepared.namedSql` receives a value, or it throws `MISSING_VALUE`;
- no placeholder survives in either output, or it throws `UNRESOLVED_PLACEHOLDER`;
- values are type/cardinality-checked against the declarations;
- literals are escaped with the dialect-correct escaper from Step 4;
- both outputs re-pass `validateSelectSql` for `prepared.dialect`.

Tenant placeholders bind by name here just like business ones (`":tenant_agency_ids"` takes an array of IDs). **Authorization remains the host's**, exactly as it is today when the host constructs `tenantScope` — document this explicitly (Step 9).

### Dialect marker and escaping rules

Add two optional fields to `DialectSpec`:

```ts
/** How list-valued placeholders bind in `unboundSql`. Default "expand" when absent. */
listBinding?: "array" | "expand";
/** Whether backslash is an escape character inside string literals. Default false. */
backslashEscapes?: boolean;
```

| Dialect | Scalar marker | `listBinding` | List form in `unboundSql` | `backslashEscapes` |
| --- | --- | --- | --- | --- |
| `postgres`, `cockroachdb` | `$1`, `$2`, … | `"array"` | `= ANY($1)` — one marker, arity-stable | `false` |
| `mysql`, `mariadb` | `?` | `"expand"` | `IN (?, ?, ?)` | **`true`** |
| `sqlite` | `?` | `"expand"` | `IN (?, ?, ?)` | `false` |
| `sqlserver` | `@p0`, `@p1`, … | `"expand"` | `IN (@p3, @p4, @p5)` | `false` |

Only Postgres/CockroachDB have a real array parameter type, so only they get the arity-stable driver form. Scalar placeholders allocate one marker per **occurrence**, even when repeated, because `?` dialects have no other option and it keeps the audit list deterministic.

Note the SQL Server off-by-one: markers are `@p0`-based while `indices` is 0-based and `markers` is per-parameter — hosts map values via `parameters[].markers`, never by computing marker names themselves.

A custom `AskDialect` builds its own prompt, so AskDB cannot inject the manifest instruction. `parameterize` is therefore **silently inert** for custom dialects — no error, no extra fields. This is required for backward compatibility now that the default is on.

### Output-mode interaction

- `tenantSqlMode` keeps its current meaning and `"sql-only"` default. When `"sql-only"`, tenant IDs are inlined as literals exactly as today and contribute no markers.
- When `tenantSqlMode` is `"sql-params"`, business markers are allocated first (1..N) and tenant markers continue from N+1 via the existing `paramStartIndex` argument of `resolveTenantSql` (`tenant-placeholders.ts:204-241`).
- `result.params` is the full ordered array. `tenantParams` and `tenantBindings` keep their current tenant-only meaning; document that a caller using the new fields must execute with `params`, not `tenantParams`.

### Errors

```ts
export type QueryParameterRejectionReason =
  | "INVALID_NAME"
  | "RESERVED_NAME"
  | "INVALID_VALUE"
  | "MISSING_VALUE"
  | "UNRESOLVED_PLACEHOLDER"
  | "INVALID_LIST_CONTEXT"
  | "DIALECT_UNSUPPORTED";

export class QueryParameterError extends AskDbError {
  constructor(message: string, public readonly reason: QueryParameterRejectionReason) {
    super(message);
    this.name = "QueryParameterError";
  }
}
```

Reachable only from `bindPreparedQuery()`. Inside `ask()`, every one of these conditions instead drops the extras (see the degradation table). Messages must be actionable and must never include a parameter value.

## Commands you will need

| Purpose | Command | Expected on success |
| --- | --- | --- |
| Install | `pnpm install --frozen-lockfile` | exit 0; lockfile unchanged |
| Core tests | `pnpm --filter @askdb/core test` | exit 0 |
| Client tests | `pnpm --filter @askdb/client test` | exit 0 |
| Core typecheck | `pnpm --filter @askdb/core lint` | exit 0 |
| Client typecheck | `pnpm --filter @askdb/client lint` | exit 0 |
| Full test suite | `pnpm test` | exit 0 |
| Full typecheck | `pnpm lint` | exit 0 |
| Docs build | `pnpm docs:build` | exit 0 |
| Installable package check | `pnpm smoke:install` | exit 0 |
| Release preflight | `pnpm preflight` | exit 0 |

## Scope

**In scope** (the only source/docs files that should be modified):

- `packages/core/src/ask.ts`
- `packages/core/src/errors.ts`
- `packages/core/src/index.ts`
- `packages/core/src/sql/index.ts`
- `packages/core/src/sql/bind.ts` (create — shared tokenizer, scanner, escaper, marker allocation, `bindPreparedQuery`)
- `packages/core/src/sql/parameter-manifest.ts` (create — manifest types, parsing, validation)
- `packages/core/src/sql/dialect-spec.ts`
- `packages/core/src/sql/extract-sql.ts`
- `packages/core/src/sql/generate.ts`
- `packages/core/src/sql/prompt.ts`
- `packages/core/src/sql/tenant-placeholders.ts` (reimplement over the shared binder; public signatures preserved, escaper fixed)
- `packages/core/src/sql/validate.ts` (extract the shared tokenizer only; guardrail behavior unchanged)
- `packages/core/src/logging/log-events.ts`
- Focused tests under `packages/core/src/`: create `bind.test.ts` and `parameter-manifest.test.ts`; extend `extract-sql`, `generate.test.ts`, `ask.test.ts`, `tenant-placeholders.test.ts` (escaper cases only)
- `packages/client/src/client.test.ts` (passthrough assertion only — no `client.ts` change)
- `packages/client/src/client.smoke.test.ts`
- `packages/core/README.md`, `packages/client/README.md`
- `docs/specs/core-pipeline.md`, `docs/specs/multi-tenancy.md`, `docs/contracts/tenant-policy.md`
- `apps/docs-site/src/content/docs/reference/core-api.mdx`, `.../reference/client-api.mdx`, `.../guides/embed-in-node.mdx`, `.../guides/multi-tenancy.mdx`
- one new `.changeset/*.md`
- `plans/README.md` (status only)

**Out of scope** (do not touch, even though related):

- `packages/client/src/client.ts` — the facade already forwards options and returns the core result verbatim. If you believe a change is needed here, that is a STOP condition.
- `apps/studio/**` — a visual parameter editor is a follow-up once this contract exists. Existing Studio tests must pass unchanged.
- `apps/http-api/**` — do not accept caller-supplied prepared SQL over a network boundary.
- `apps/cli/**` — the one-shot CLI does not benefit from a parameter manifest.
- `tenant-prompt.ts` tenant placeholder instructions, and the `=` → `IN` tolerance in `replaceOperatorAware` — preserving these keeps tenant behavior unchanged.
- The `mentionsIdentifier` `\b:` bug in `tenant-guardrail.ts:190-193` (see "Maintenance notes"). Real, but separate.
- Any built-in cache, cache key, TTL, persistence, encryption, or signing mechanism.
- Fingerprints, schema-drift detection, or tenant access-shape comparison at bind time.
- Host-declared `{{token}}` parameters.
- SQL AST/parser dependencies.
- Database execution — AskDB returns SQL; the host executes.

## Git workflow

- Keep the current branch name unless the operator directs otherwise.
- Suggested commits: `fix(core): make SQL literal escaping dialect-aware`, `feat(core): add shared SQL parameter binder`, `feat(core): return unbound SQL and parameter manifest from ask()`, `docs: document parameterized ask output`.
- Add one changeset with a minor bump for `@askdb/core`. The root Changesets config links core with the CLI/HTTP release train; let Changesets calculate linked consequences rather than hand-editing versions.
- Do not push or open a PR unless the operator explicitly requests it.

## Steps

### Step 1: Establish the baseline

Run `pnpm install --frozen-lockfile`, then `pnpm --filter @askdb/core test`, `pnpm --filter @askdb/client test`, `pnpm --filter @askdb/core lint`, and `pnpm --filter @askdb/client lint`. Record the test counts in your handoff notes.

**Verify**: all four commands exit 0. If any fails before you have edited anything, STOP and report.

### Step 2: Add dialect capabilities and harden SQL extraction

In `dialect-spec.ts`, add `listBinding?: "array" | "expand"` and `backslashEscapes?: boolean` with the JSDoc from "Dialect marker and escaping rules". Populate them per the table: `"array"` + `false` on `POSTGRES_DIALECT` (CockroachDB inherits by spread); `"expand"` + **`true`** on `MYSQL_DIALECT` (MariaDB inherits); `"expand"` + `false` on `SQLITE_DIALECT` and `SQLSERVER_DIALECT`. Absent must be treated as `"expand"` / `false` so third-party specs keep working.

In `extract-sql.ts`, make the extractor prefer an explicitly `sql`-tagged fence, then fall back to an untagged one, and never return a fence tagged with anything else. The current regex treats the tag as optional and will return a ```json or ```sql-unbound block if it appears first (`extract-sql.ts:6`). Keep single-block and bare-prose behavior identical. Add an `extractUnboundSqlFromModelText` for the ```sql-unbound fence.

Extend the extract-sql tests: a reply with `sql`, `sql-unbound`, and `json` blocks in any order returns the right one from each extractor; a reply with only an untagged fence still returns its contents; a reply with only a `json` fence returns no SQL.

**Verify**: `pnpm --filter @askdb/core test -- extract-sql dialect-spec` → all pass.

### Step 3: Build the shared tokenizer, scanner, and binder

Create `packages/core/src/sql/bind.ts` containing:

1. **A span-returning SQL tokenizer.** Extract the quote-state logic already in `validate.ts:110-153` (`stripSqlStringLiterals`) into a shared function returning the offsets of code vs. quoted regions, extended to also recognize MySQL backticks and SQL Server brackets. Have `validateSelectSql` consume it so there is exactly one quote-state machine in the codebase; its observable behavior must not change.
2. **A placeholder scanner** finding `:name` and `:tenant_*_ids` tokens **only outside** quoted regions, returning `{ name, start, end }` in source order. A quoted `':name'` is therefore invisible by construction — that is the fail-safe described in "The two execution paths".
3. **List-context validation** — a `many` placeholder must be the sole expression inside `IN (...)` / `NOT IN (...)`, or the sole argument of `= ANY(...)` on array dialects.
4. **Substitution and marker allocation**, replacing occurrences right-to-left so offsets stay valid, while emitting `params` in left-to-right occurrence order.
5. **`bindPreparedQuery(prepared, values)`** returning both `sql` and `unboundSql` + `params` per "Local rebind utility".

Create `bind.test.ts` covering: scalar and list binding per dialect; repeated scalars; right-to-left substitution correctness; placeholder-looking text inside every supported quote form left untouched; **a quoted `':name'` marker not being detected**; `MISSING_VALUE` / `UNRESOLVED_PLACEHOLDER` / `INVALID_LIST_CONTEXT`; and Postgres `$1` markers surviving `validateSelectSql` re-validation (its dollar-quote branch must not mistake `$1` for a dollar-quoted string).

**Verify**: `pnpm --filter @askdb/core test -- bind validate` → all pass.

### Step 4: Make literal escaping dialect-aware

This is a security fix and must land before anything routes user values through it.

Move escaping into `bind.ts` as an exported, dialect-aware function. Rules:

- Strings/dates/datetimes: wrap in single quotes and double every embedded single quote. **When the dialect has `backslashEscapes: true` (MySQL/MariaDB), also double every backslash.** Without this, a value ending in `\` consumes its closing quote and the rest of the statement becomes string content.
- Numbers: finite only; reject `NaN`/`Infinity`. Never `String(value)` on an unvalidated input.
- Booleans: emit `TRUE`/`FALSE`.
- Reject null bytes and unescaped control characters.
- Lists expand to a comma-separated parenthesized group, each element escaped individually.

Rewire `replacePlaceholdersWithLiterals` (`tenant-placeholders.ts:120-135`) onto it. `resolveTenantSql` gains an **optional trailing** dialect argument; when omitted it must behave exactly as today (quote-doubling only), so existing callers are unaffected. `ask()` passes the resolved dialect.

Add cases to `tenant-placeholders.test.ts`: a tenant ID ending in a backslash produces a safely escaped literal under MySQL, and the pre-existing non-dialect call path is byte-identical to today. Add the same matrix to `bind.test.ts` for business values, including the two-parameter injection shape (`["\\", " OR 1=1"]`).

**Verify**: `pnpm --filter @askdb/core test -- bind tenant-placeholders` → all pass, and the rest of `tenant-placeholders.test.ts` passes **with no edits to existing cases**. If an existing case needs changing, STOP — the refactor changed behavior.

### Step 5: Reimplement the tenant path over the shared primitives

Rewire `tenant-placeholders.ts` to use the shared tokenizer, scanner, and substitution from `bind.ts`. **Every exported signature and observable behavior stays the same**, including `resolveTenantSql`'s `paramStartIndex`, the `sql-only` literal path, and the `=` → `IN` rewriting in `replaceOperatorAware`.

**Verify**: `pnpm --filter @askdb/core test -- tenant` → all tenant suites pass, with `tenant-placeholders.test.ts` changed only by the escaper cases added in Step 4.

### Step 6: Add manifest types, parsing, and validation

Create `packages/core/src/sql/parameter-manifest.ts` with the parameter types, a Zod schema for the manifest, and `parseParameterManifest(modelText)` extracting and validating the ```json fence.

Cross-validation against the unbound SQL:

- every manifest parameter appears at least once as a placeholder;
- no non-tenant placeholder in the unbound SQL is absent from the manifest;
- names match `^[a-z][a-z0-9_]*$` and use neither the `tenant_` nor `askdb_` prefix;
- values match declared type and cardinality;
- list placeholders sit in valid list context.

Add `QueryParameterError` and `QueryParameterRejectionReason` to `errors.ts`, matching the `TenantScopeError` shape at `errors.ts:44-58`.

Every validator returns a typed failure the caller can act on; **`ask()` turns failures into "drop the extras", while `bindPreparedQuery()` throws.** Do not make the manifest layer itself decide which.

Create `parameter-manifest.test.ts` covering a valid manifest, malformed JSON, each rejection condition, an empty `parameters` array treated as "no parameters", and a manifest declaring a `:tenant_*` placeholder.

**Verify**: `pnpm --filter @askdb/core test -- parameter-manifest` → all pass.

### Step 7: Teach the prompt and generator the parameterize path

Thread `parameterize?: boolean` through `AskDialectGenerateOptions` (`ask.ts:27-35`) and `GenerateSqlDeps` (`generate.ts:20-41`) into `buildNlToSqlUserPrompt()`.

When on, append an output-format block after the existing rules instructing the model to emit: the SQL as it would today in a ```sql fence; the same statement in a ```sql-unbound fence with `:name` placeholders substituted for values taken from the question; then a ```json manifest of `{name, type, cardinality, description, value}`. The block must state that placeholders are never quoted, that `$1`/`?`/`@p0` are never written, that multi-value placeholders use `IN (:name)` (or `= ANY(:name)` on array dialects — branch on `dialect.listBinding`), that `:tenant_*` placeholders stay exactly as the tenant policy block instructs, and that only values from the user's question are parameterized — not structural constants the model chose.

**When `parameterize` is off the prompt must be byte-for-byte identical to today.** Assert this with a test comparing the prompt built with the flag off against the current output.

In `generate.ts`: extract the bound SQL and run `validateSelectSql` on it exactly as today. When parameterize is on, additionally extract the unbound block and manifest, cross-validate, and run `validateTenantGuardrails` against the **unbound** SQL when a tenant policy is present — tenant placeholders are still named there, matching today's behavior. Return the unbound SQL and validated manifest as optional extras on `GenerateSelectSqlResult`; **any failure clears the extras rather than throwing.**

Add `PipelineParameterized: "askdb.pipeline.parameterized"` to `AskDbLogEvent`, emitted with **counts only** (`parameterCount`, `listParameterCount`), plus a debug-level `reason` when extras are dropped. Never log names or values.

**Verify**: `pnpm --filter @askdb/core test -- generate prompt tenant-guardrail` → all pass; the prompt-identity test proves the flag-off prompt is unchanged.

### Step 8: Integrate into `ask()` and prove the client forwards it

In `ask.ts`:

1. Add `parameterize?: boolean` to `AskPipelineOptions` (default true) and the new result fields to `AskPipelineResult`.
2. Forward the flag into `dialect.generate`. For a custom `AskDialect`, it is inert — no error.
3. Keep `result.sql` as the model's bound SQL. Never overwrite it with a re-bound version.
4. When a validated manifest came back, build the `PreparedQuery`, call `bindPreparedQuery()` with the manifest values, and **compare its `sql` structurally against the model's bound SQL**. On mismatch, drop the extras and log at debug.
5. On agreement, populate `unboundSql`, `params`, `parameters`, and `preparedQuery`.
6. Bind tenant placeholders after business ones, passing `businessParams.length + 1` as `resolveTenantSql`'s `paramStartIndex` when `tenantSqlMode` is `"sql-params"`. When `"sql-only"` (the default), the tenant path is unchanged and contributes no markers.

Export `bindPreparedQuery`, `QueryParameterError`, and all new public types from `packages/core/src/sql/index.ts` and `packages/core/src/index.ts`, matching the export-block style at `index.ts:8-25`.

Do **not** edit `packages/client/src/client.ts`. Add a `client.test.ts` case calling `askdb.ask(question, { deps: { generateText: spy } })` with a three-block reply and asserting the new fields arrive through the facade. Extend `client.smoke.test.ts` so a consumer can import `PreparedQuery`, `BoundQuery`, `QueryParameterBinding`, and `bindPreparedQuery` through the public barrels and call the binder.

**Verify**: `pnpm --filter @askdb/core test && pnpm --filter @askdb/core lint && pnpm --filter @askdb/client test && pnpm --filter @askdb/client lint` → exit 0, and `git status --short packages/client/src/client.ts` shows no modification.

### Step 9: Document the contract and the trust boundary

Update the package READMEs, the three internal specs, and the four docs-site pages in scope. Use one consistent example:

```ts
const result = await askdb.ask("How many cities does Colorado have?", { tenantScope });

// Execute either form.
await pool.query(result.sql);                        // ready to run
await pool.query(result.unboundSql!, result.params);  // driver binding

// Render a form from result.parameters, then rebind locally — no model call.
const rebound = bindPreparedQuery(result.preparedQuery!, {
  state_name: "Utah",
  ":tenant_agency_ids": authorizedAgencyIds,
});
await pool.query(rebound.sql);
```

Docs must state plainly:

- every `ask()` is exactly one model call; `parameterize` does not add or remove one, and nothing here lets a caller skip it;
- `parameterize` defaults to true and exists to be turned *off* when the extra output tokens are not worth it;
- the question is sent to the model unchanged, values included — this is not a redaction feature;
- if the model's extra blocks are missing or inconsistent, the extras are omitted and `result.sql` is unaffected;
- the model decides what to parameterize, so a mistake changes the *form*, not the query;
- a value the model bound to one column may not suit a different value a user types into that field (a code column vs. a name column) — hosts should constrain form inputs using the returned `type` and `description`;
- `bindPreparedQuery()` is mechanical: it checks names, types, and cardinality, and **does not authorize tenant IDs**. Authorization is the host's, exactly as it is today when it builds `tenantScope`;
- callers using the new fields must execute with `params`, not `tenantParams`;
- list parameters are arity-stable in `unboundSql` only on PostgreSQL/CockroachDB (`= ANY($n)`); elsewhere a changed list length changes the marker count, so rebind through `bindPreparedQuery()` rather than swapping the array;
- driver examples for PostgreSQL/MySQL/SQLite/SQL Server use the marker style actually returned, and map values via `parameters[].markers` for SQL Server.

**Verify**: `pnpm docs:build` → exit 0.

### Step 10: Release metadata and full gates

Add one changeset with a minor bump for `@askdb/core`, describing the new result fields, `bindPreparedQuery`, the `parameterize` opt-out, `DialectSpec.listBinding`/`backslashEscapes`, **the MySQL/MariaDB literal-escaping fix**, and the unchanged-by-default guarantee. Follow the prose style of `.changeset/032-unify-studio-execute.md`.

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
- **Escaping matrix**: value containing `'`; value ending in `\` under MySQL/MariaDB vs. the other dialects; the two-parameter `["\\", " OR 1=1"]` injection shape producing safe SQL; `NaN`/`Infinity` rejected; null byte rejected.
- Quoted `':name'` in the model's unbound SQL is not detected, so the extras are dropped and `result.sql` is unaffected.
- `$1`, `?`, `@p0` markers emitted for the right dialects; `= ANY($1)` on Postgres, `IN (?, ?)` on MySQL/SQLite.
- Repeated scalar placeholder allocates one marker per occurrence in source order.
- Placeholder-looking text inside single quotes, double quotes, backticks, brackets, and dollar-quoted strings left untouched.
- All five degradation rows, each asserting `result.sql` still equals the model's bound SQL and that nothing throws.
- Bound and unbound blocks that disagree → extras dropped.
- Each `QueryParameterRejectionReason` fires from `bindPreparedQuery()` for its condition.
- Combined business + tenant in `tenantSqlMode: "sql-only"` (tenant literals, business markers) and `"sql-params"` (continuous marker sequence).
- `tenantParams` and `tenantBindings` keep tenant-only contents in both modes.
- `parameterize: false` produces a result deep-equal to today's from a byte-identical prompt.
- Custom `AskDialect` is unaffected and returns no extra fields.
- `bindPreparedQuery()` round-trips a JSON-serialized `PreparedQuery` and calls no model, retriever, or schema loader.
- Existing `tenant-placeholders.test.ts` cases pass unmodified.

## Done criteria

ALL must hold:

- [ ] `ask()` returns `sql`, `unboundSql`, `params`, `parameters`, and `preparedQuery` after exactly one model call when the model complies.
- [ ] `result.sql` is always the model's bound SQL and is never affected by any failure in the parameterize path.
- [ ] No new error can reach a caller who does not call `bindPreparedQuery()`.
- [ ] `parameterize: false` produces a result deep-equal to today's from a byte-identical prompt.
- [ ] Literal escaping is dialect-aware; a value ending in `\` cannot break out of its string on MySQL/MariaDB.
- [ ] Placeholders are unquoted in the template, and a quoted marker causes the extras to be dropped rather than an unsafe substitution.
- [ ] `bindPreparedQuery()` is exported, pure, synchronous, returns both forms, and is the same function `ask()` uses for its consistency check.
- [ ] Business and tenant placeholders share one tokenizer, scanner, and escaper; existing `tenant-placeholders.test.ts` cases pass unmodified.
- [ ] `preparedQuery` contains no runtime values; `parameters[].value` does, by design.
- [ ] Markers are dialect-correct, with `= ANY($n)` only on Postgres/CockroachDB.
- [ ] Custom `AskDialect` calls are unaffected.
- [ ] `packages/client/src/client.ts` is unmodified and the facade forwards the option and result.
- [ ] READMEs, specs, and docs-site pages describe the implemented API, the one-model-call rule, and the authorization boundary.
- [ ] A changeset covers the `@askdb/core` minor, including the escaping fix.
- [ ] `pnpm test`, `pnpm lint`, `pnpm docs:build`, `pnpm smoke:install`, `pnpm preflight`, `git diff --check` all exit 0.
- [ ] No files outside the in-scope list are modified.
- [ ] `plans/README.md` marks plan 033 DONE (unless maintained by a reviewer).

## STOP conditions

Stop and report back; do not improvise if:

- Any "Current state" excerpt has materially drifted from commit `c81bb4e`, especially the public `ask()` types or tenant placeholder semantics.
- Baseline tests or typechecks fail before your first edit.
- Making existing `tenant-placeholders.test.ts` cases pass requires editing them. The refactor must be behavior-preserving apart from the added escaper cases.
- `packages/client/src/client.ts` appears to need a change.
- Making the flag-off prompt identical to today's proves impossible.
- Any failure in the parameterize path would have to propagate to the caller instead of dropping the extras.
- Correctness seems to require sending a modified question, stripping values from the question, or rewriting the question with tokens. That is a different design and needs a decision, not an improvisation.
- Tenant guardrails can only be made to pass by validating substituted SQL instead of the named form.
- A list placeholder cannot be proven to sit in valid list context and the temptation is to add operator-aware rewriting at bind time. Drop the extras instead.
- The dialect-aware escaper cannot be proven safe for a dialect by test — do not ship a partial escaper.
- Any error message or log line would have to contain a parameter value.
- Any verification step fails twice after a reasonable correction.

## Maintenance notes

- `PreparedQuery.version` is a serialization contract. Add a V2 with a migration path for shape changes; never reinterpret stored V1 artifacts.
- **The duplicate SQL block is a deliberate, temporary cost.** Having the model emit both forms means `result.sql` is verbatim today's output, so the feature cannot regress existing callers. Once the consistency check has shown a high agreement rate in production, a follow-up can drop the bound block and let AskDB derive `sql` by substitution, saving those output tokens. Instrument the agreement rate before making that call.
- **Deliberately deferred: host-declared `{{token}}` parameters.** Model-supplied extraction was chosen because it needs no new host syntax and works on free-text questions. An explicit declaration mode can be added *alongside* this one later; it does not replace it.
- `mentionsIdentifier` (`tenant-guardrail.ts:190-193`) wraps patterns in `\b`, so its placeholder checks at `:96` and `:113` never match real SQL (`\b:` requires a word character immediately before the colon). Only the column-name checks are load-bearing today. Out of scope here; worth its own small plan.
- A future Studio plan can build a parameter editor directly from `result.parameters` and call `bindPreparedQuery()` locally, re-executing without another token-usage event.
- If an HTTP bind surface is ever added, store prepared queries server-side behind opaque, user-owned IDs with bounded TTL/LRU. Do not trust an artifact posted by a client merely because it passes SELECT validation.
- Reviewers should scrutinize: the dialect-aware escaper (every branch, every dialect), quote-state scanning, the unquoted-marker fail-safe, list-context validation, marker ordering across the business→tenant boundary, all five degradation rows, and every path where a parameter value could reach a log line or an error message.
