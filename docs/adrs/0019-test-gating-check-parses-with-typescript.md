# ADR 0019 — The test-gating check parses test files with the TypeScript compiler

## Status

Proposed (2026-10-09, #326). Implemented in `scripts/check-test-gating.mjs`, run by the root `lint` script; its contract is the fixture corpus in `scripts/test-fixtures/check-test-gating/`.

## Context

CI sets `ASKDB_REQUIRE_INTEGRATION=1` so a missing database or driver fails an integration suite instead of skipping it. That works only for suites gated through `integrationSuite()` (`scripts/test-utils/integration.mjs`). A hand-rolled gate (`describe.skip`, `describe.skipIf(…)`, `cond ? describe : describe.skip`, `{ skip: cond }` options, or a suite defined under an `if`) skips silently, so a misconfigured job passes by running nothing. `pnpm lint` runs a check that rejects these gates in the `*.test.ts` and `*.test.tsx` files of every workspace package in `pnpm-workspace.yaml` except the consumer lab, which is its own pnpm root and fails on a missing fixture by design.

A regex design, matching over the source after blanking comments and string, template and regex literals with a hand-written lexer, has two problems. A lexer that doesn't read JSX text treats a `/*` or a backtick in a `.test.tsx` file as the start of a comment or template, blanks the rest of the file, and the check passes it unread. And a conditional-call rule that looks only at the token before a call misses a suite defined as the second statement of an `if` block.

## Options considered

### A. Regexes over a hand-lexed source

Rejected. Every construct the lexer misreads is a way past the gate, and the misreads fail open. Each fix adds lexer code (JSX, regex-versus-division, template nesting) that duplicates a parser the repo already installs.

### B. An ESLint rule

Rejected for now. The repo runs ESLint only in Studio; a root ESLint setup with a TypeScript parser and a custom rule plugin for one check adds a toolchain and its config to every package's lint, for no capability over C.

### C. Walk the TypeScript AST (chosen)

`typescript` is already a root devDependency (`^6.0.3`, locked in `pnpm-lock.yaml`). `ts.createSourceFile` parses `.ts` and `.tsx` (JSX included) without type-checking, so the check stays fast and needs no `tsconfig`. Rules become predicates over a reference to `describe`/`suite`/`it`/`test` (the globals, a renamed or namespace import from `vitest`, `await import("vitest")` or `require("vitest")` (or a member read off one), or a variable holding `test.extend({…})`; names resolve through the binder of a one-file program, so a local declaration that shadows one is not Vitest's): its modifier links, whether it is invoked, whether it is a ternary branch, and whether a condition (`if`/`else`, `switch` case, `try`/`catch`, `? :`, `&&`, `||`, `??`, a loop over a table a condition picks, or a callback passed to a call other than `forEach`/`map`/`flatMap`) sits between the call and the nearest enclosing suite, test or named function. `integrationSuite({…})` and a variable holding its result are suite functions, so its own gate passes.

### Where the check runs

- **First step of the root `lint` script (chosen).** CI's lint job, `scripts/release-preflight.sh` and a local `pnpm lint` all call it, so there is one place to wire and nothing to keep in step.
- **Its own CI job.** Rejected: it would run in CI only, not in preflight or locally, and a second job is one more list of steps to keep in step with lint.
- **A Vitest test in a workspace package.** Rejected: the check reads every package, so it belongs to none of them, and `pnpm test` with a filter would skip it.

## Decision

The check parses each test file with `ts.createSourceFile` and applies its rules to the AST. A use of a Vitest function it can't read (an alias, an argument, `x && describe`, `describe.call(…)`, a spread or computed key in the options) fails the check rather than passing. A file with parse errors fails the check, naming the file, instead of being skipped. Wrappers that leave a value unchanged (`(x)`, `x!`, `x as T`, `<T>x`, `x satisfies T`) are seen through. `typescript` is loaded from the script's real path, so a symlinked invocation finds the repo's install.

The check runs first in the root `lint` script, so it runs wherever lint runs: locally, in CI's lint job and in `scripts/release-preflight.sh`. A line that needs a gate on purpose takes `// check-test-gating-ignore-next-line: <reason>` on the line above; a marker with no reason, or one in a block comment, string or JSX text, exempts nothing. The script's own tests use `node --test` with a fixture corpus beside it (`scripts/test-fixtures/check-test-gating/`), because `scripts/` is not a workspace package that `pnpm test` runs and the root `vitest.config.ts` includes only `*.test.ts(x)`; `pnpm lint` runs them before the check.

## Consequences

- Comments, strings, templates, regexes and JSX text can't trip or hide a rule; only code can.
- The check is tied to the TypeScript 5/6 compiler API. TypeScript 7 exports only `version` from the package entry point and moves the API under `typescript/unstable/*`, so the PR that moves the root `typescript` to 7 must port this check to that API, or keep the 6.x API under an npm alias (`"typescript-ast": "npm:typescript@^6"`) and load that. Until then the check exits 1 with a message naming this ADR, so the upgrade can't pass lint silently.
- The check depends on the root install: `pnpm lint` already runs after `pnpm install` locally, in CI and in `scripts/release-preflight.sh`.
- Parse errors come from `getSyntacticDiagnostics` on a one-file program with no lib, no module resolution and no emit, all public API. Any other error while checking a file also fails the check, naming the file.
- Still not detected: an early `return` before a call, a gate inside a named helper that is called under a condition, options passed in a variable, a `.each` table or loop filtered at run time, a test API imported from another module, a module specifier built at run time, and `ctx.skip()` in a test body. Catching these needs data flow, not syntax; the review profile asks reviewers to read new suites for them.
