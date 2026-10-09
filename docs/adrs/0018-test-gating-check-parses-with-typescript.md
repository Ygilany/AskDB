# ADR 0018 — The test-gating check parses test files with the TypeScript compiler

## Status

Proposed (2026-10-09, #326). Implemented in `scripts/check-test-gating.mjs`, run by the root `lint` script; its contract is the fixture corpus in `scripts/__fixtures__/check-test-gating/`.

## Context

CI sets `ASKDB_REQUIRE_INTEGRATION=1` so a missing database or driver fails an integration suite instead of skipping it. That works only for suites gated through `integrationSuite()` (`scripts/test-utils/integration.mjs`). A hand-rolled gate (`describe.skip`, `describe.skipIf(…)`, `cond ? describe : describe.skip`, or a suite defined under an `if`) skips silently, so a misconfigured job passes by running nothing. `pnpm lint` runs a check that rejects these gates in every workspace package's `*.test.ts` and `*.test.tsx`.

The first version matched regexes over the source after blanking comments and string, template and regex literals with a hand-written lexer. Review of #326 found two problems with that design. The lexer did not understand JSX text, so a `/*` or a backtick in a `.test.tsx` file blanked the rest of the file and the check passed it unread. And the conditional-call rule looked only at the token before a call, so a suite defined as the second statement of an `if` block was missed.

## Options considered

### A. Regexes over a hand-lexed source (the first version)

Rejected. Every construct the lexer misreads is a way past the gate, and the misreads fail open. Each fix adds lexer code (JSX, regex-versus-division, template nesting) that duplicates a parser the repo already installs.

### B. An ESLint rule

Rejected for now. The repo runs ESLint only in Studio; a root ESLint setup with a TypeScript parser and a custom rule plugin for one check adds a toolchain and its config to every package's lint, for no capability over C.

### C. Walk the TypeScript AST (chosen)

`typescript` is already a root devDependency, pinned with the rest of the toolchain. `ts.createSourceFile` parses `.ts` and `.tsx` (JSX included) without type-checking, so the check stays fast and needs no `tsconfig`. Rules become predicates over a reference to `describe`/`suite`/`it`/`test`: its modifier links, whether it is invoked, whether it is a ternary branch, and whether a condition (`if`/`else`, `switch` case, `try`/`catch`, `? :`, `&&`, `||`, `??`) sits between the call and the nearest enclosing suite, test or named function.

## Decision

The check parses each test file with `ts.createSourceFile` and applies its rules to the AST. A file with parse errors fails the check, naming the file, instead of being skipped. Wrappers that leave a value unchanged (`(x)`, `x!`, `x as T`, `<T>x`, `x satisfies T`) are seen through. `typescript` is loaded from the script's real path, so a symlinked invocation finds the repo's install.

## Consequences

- Comments, strings, templates, regexes and JSX text can't trip or hide a rule; only code can.
- The check depends on the root install: `pnpm lint` already runs after `pnpm install` locally, in CI and in `scripts/release-preflight.sh`.
- Parse errors come from `getSyntacticDiagnostics` on a one-file program with no lib, no module resolution and no emit, all public API. Any other error while checking a file also fails the check, naming the file.
- Still not detected: an early `return` before a call, a gate behind a helper or alias, and `ctx.skip()` in a test body. Catching these needs data flow, not syntax; the review profile asks reviewers to read new suites for them.
