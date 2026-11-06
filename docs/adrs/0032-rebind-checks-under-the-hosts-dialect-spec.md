# ADR 0032 — A rebind checks and renders under the host's dialect spec, or refuses

## Status

Accepted (2026-11-05). Settled on [#660](https://github.com/Ygilany/AskDB/issues/660) under the release's rule that safety wins over convenience. Implemented by the `dialectRules` field of `PreparedQuery` (`packages/core/src/sql/bind.ts`), set in `ask()`, and the `dialect` option of `BindGuardrails` with its resolution in `readPreparedQueryDialect()` (`packages/core/src/sql/checked-statement.ts`). It extends [ADR 0010](0010-sql-guardrail-decision-point.md)'s re-check at rebind: the bind-time schema, scope and modes now come with the bind-time dialect rules. It amends [ADR 0029](0029-core-owns-built-in-dialect-specs.md), whose spread spec held in `ask()` only.

## Context

A host adjusts a built-in engine's rules by spreading its spec ([ADR 0029](0029-core-owns-built-in-dialect-specs.md)), such as `{ ...POSTGRES_DIALECT, backslashEscapes: true }` for Postgres with `standard_conforming_strings = off`, or `{ ...MYSQL_DIALECT, blockedFunctions: [...MYSQL_DIALECT.blockedFunctions, "my_udf"] }`. The docs recommend this. `ask()` checks and renders under that spec.

The stored `PreparedQuery` recorded only the spec's `id`, so `bindPreparedQuery()` checked and rendered under the built-in spec for that id. The host's rules were dropped at rebind:

- **String settings.** Under the host's `backslashEscapes: true`, the business value `\' OR 1=1 --` rebound as `status = '\'' OR 1=1 --'`, with verdict `allow`. A backslash-escaping server ends that literal early and runs the `OR`. The host's own spec rejects the SQL.
- **Host rules.** A stored template calling a function the host blocks, or failing the host's `extraValidate`, rebound with verdict `allow`.

`bindPreparedQuery()` can't recover the spec from the artifact, and it can't tell whether a stored artifact was made under one.

## Decision

1. **The artifact records which rules made it.** `ask()` sets `PreparedQuery.dialectRules` to `"builtin"` when it ran with the built-in spec for `dialect`: a built-in id, or the exported constant such as `POSTGRES_DIALECT`. Any other `DialectSpec` object makes it `"host"`, including an unchanged spread and a constant from a second copy of `@askdb/core` (ESM beside CJS), which is another object.
2. **The host passes its rules at rebind.** `BindGuardrails.dialect` (and `askdb.bind()`'s options) takes the `DialectSpec` `ask()` ran with, or a built-in id. Its `id` must equal the template's `dialect`, or the rebind throws `QueryParameterError` (`DIALECT_UNSUPPORTED`). The rebind uses it everywhere it used the built-in spec: the guardrail plan, rendering and escaping, tenant rendering, and the final `validateSelectSql`. `ask()`'s own consistency render uses the host's spec too.
3. **A rebind never guesses the rules.** A `"host"` template without `dialect` throws `QueryParameterError` (`DIALECT_SPEC_REQUIRED`). So does a template stored without `dialectRules`, since it may have been made under a host's spec. The message names the fix: pass the spec, or the built-in id (such as `"postgres"`) when `ask()` ran with the built-in rules. A `"builtin"` template rebinds under the built-in spec when no `dialect` is passed.

## Options considered

- **A fingerprint of the spec's rules in the artifact.** It would also refuse a rebind under a different spec. Rejected: `extraValidate` is a function and can't be compared, and the fingerprint is more stored shape to keep stable.
- **No reuse artifacts for a spec object** (`ask()` returns no `preparedQuery` or `unboundSql`). No shape change. Rejected: it takes rebind away from exactly the hosts the docs tell to spread a spec.
- **`dialect` required on every rebind.** Rejected: every bind call would change again, right after beta.45 made the third argument required. Built-in hosts gain nothing from it.
- **Rebind an artifact without `dialectRules` under the built-in rules, as before.** Rejected: an artifact stored under a host's spec would keep the hole, and AskDB can't tell which ones those are.

## Consequences

- **Breaking for stored artifacts.** A `PreparedQuery` stored before `dialectRules` existed is refused at rebind until the host passes `dialect`. A built-in id is enough when `ask()` ran with the built-in rules.
- **Breaking for hosts that spread a spec.** They pass the same spec to `bindPreparedQuery()` or `askdb.bind()`. A host whose app loads two copies of `@askdb/core` passes `dialect` too, or the built-in id.
- **The host's spec is trusted as given.** A rebind can't tell whether the passed spec is the one `ask()` ran with; it checks the SQL under the spec the host passes.
- **A template built by hand** has no `dialectRules`, so it needs `dialect` at rebind.
- **The label is the host's own stored data.** AskDB doesn't sign the artifact, as it doesn't sign `namedSql`. A host that rewrites `dialectRules` to `"builtin"` gets the built-in rules, so the docs never tell a host to set the label by hand. This keeps [ADR 0010](0010-sql-guardrail-decision-point.md)'s rule of no stored verdict: the rebind still re-checks the template, and the label only says which rules the host must name. A host that wants its rules applied whatever the artifact says passes `dialect` on every rebind.
