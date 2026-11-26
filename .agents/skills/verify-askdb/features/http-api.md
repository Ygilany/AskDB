# HTTP API

`askdb-http` serves AskDB over HTTP for a host app: `GET /health`, and `POST /ask`, which returns generated SQL as JSON with a correlation ID, token usage and the sensitive-guardrail result. It never executes SQL and refuses a request that asks it to.

## Sub-features

- `api-health` answers `{"ok":true}`. Scripted: `e2e/api/http-api.test.ts`.
- `api-ask` returns `{ ok: true, correlationId, sql, usage, sensitiveGuardrail }` for a question. Scripted: `e2e/api/http-api.test.ts`.
- `api-sensitive` reports sensitive references in `sensitiveGuardrail` without refusing. Scripted: `e2e/api/http-api.test.ts`.
- `api-refuse-write` returns 400 with `sql_validation_error` when the model's SQL isn't read-only. Scripted: `e2e/api/http-api.test.ts`.
- `api-refuse-execute` returns 400 for an `execute` field. Scripted: `e2e/api/http-api.test.ts`.
- `api-not-found` returns 404 for any other route. Scripted: `e2e/api/http-api.test.ts`.

## How to get to it (user POV)

- Start `askdb-http --schema-path <dir> [--port N] [--host H]` from a project with an `askdb.config.*`.
- Call `GET /health` and `POST /ask` with a JSON body `{ "question": "…" }`, optionally `explain`, `mode`, `omitSensitiveFromPrompt`, and the headers `x-correlation-id` and `x-askdb-mode`.

## Driving it with control-askdb

Preconditions:

- Baseline from the README.
- Run `vctl api start`. It prints `api running: pid …, http://127.0.0.1:<port>`, and `vctl doctor` shows `ok   http api`.

- **Health.** Run `vctl api-request GET /health`. Status `200`, body `{"ok":true}`.
- **Ask.** Run `vctl model reply "SELECT id, email FROM users"` and `vctl api-request POST /ask '{"question":"list users"}'`. Status `200`; `ok` is `true`, `sql` is that SQL, `correlationId` is set, and `sensitiveGuardrail.passed` is `true`.
- **Sensitive.** Run `vctl model reply "SELECT id, secret_recovery_token FROM users"` and `vctl api-request POST /ask '{"question":"tokens"}'`. Status `200`; `sensitiveGuardrail.passed` is `false`, and `references` names column `secret_recovery_token` of table `users`.
- **Refuse a write.** Run `vctl model reply "DELETE FROM users"` and `vctl api-request POST /ask '{"question":"delete users"}'`. Status `400`; `ok` is `false`, `error.code` is `sql_validation_error` and `error.rule` is `SQL_NOT_SELECT_OR_WITH`.
- **Refuse execute.** Run `vctl api-request POST /ask '{"question":"x","execute":true}'`. Status `400`; `error.code` is `bad_request` and `error.message` is `Execution is not supported. This endpoint returns generated SQL only.`
- **Not found.** Run `vctl api-request GET /nope`. Status `404`; `error.code` is `not_found`.
- **Prompt reached the model.** Run `vctl model requests --label api-ask-prompt`. A request body contains `list users`.

## Gotchas

- The repo root's config sets no schema for the API. Without `--schema-path` (which `vctl api start` passes), `/ask` answers 500 `generation_not_configured`.
- `askdb-http --port 0` binds a free port and prints the assigned port in its ready line. When using the harness, use the URL `vctl api start` prints.
- `pnpm -C apps/http-api start` runs inside `apps/http-api`, which has no config, and exits. Start it through the harness.
- `vctl api-request` exits 1 on any non-2xx status: that's the response under test, not a harness failure.
