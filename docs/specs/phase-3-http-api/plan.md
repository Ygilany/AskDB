# Plan — Phase 3 (HTTP API) (demoable milestones)

Numbered groups are **ordered** so each milestone is **demoable** and keeps parity with Phase 2 contracts (modes, correlation IDs, structured logs).

## 1 — Define the HTTP contract (docs first)

1. Specify the API shape in this spec pack:
   - endpoint(s), request JSON, response JSON
   - required/optional fields (schema, question, mode, execution toggle)
   - error response shape and error codes
2. Specify correlation behavior:
   - accepted inbound ID (header or request field)
   - generated ID when absent
   - echoed back in response

**Demo:** A documented curl example showing a successful response and an error response (with correlationId).

## 2 — Create the HTTP surface package

1. Add a new package under `packages/` for the HTTP server (name TBD during implementation).
2. Wire it to call the same `@askdb/core` entrypoints as the CLI (no duplicated NL→SQL logic).
3. Ensure logging is consistent with Phase 2 fields (same event names/shape where applicable).

**Demo:** Run the server locally and hit `/health` (or equivalent) and `/ask` returning the documented JSON.

## 3 — Modes + boundaries parity

1. Expose mode selection over HTTP and pass it through to core.
2. Prove that “strict” modes do not allow any bounded-result summarization paths (if present) and do not change trust boundaries.
3. Ensure execution is either:
   - disabled by default and explicitly enabled, or
   - absent from the HTTP surface for the initial slice (generate/validate only)

**Demo:** Same request under two modes yields the expected, observable differences (response fields and/or logs), aligned with the contract.

## 4 — Error model + status codes

1. Map core failures to stable error codes/types.
2. Choose HTTP status codes consistently (4xx for caller errors, 5xx for server faults).
3. Document retry guidance where meaningful (e.g., 429/503).

**Demo:** Intentional invalid input yields a stable error response covered by tests.

## 5 — Tests for integration readiness

1. Add tests that exercise:
   - request/response shape for success
   - error shapes for common failures
   - correlation propagation
   - mode selection wiring
2. Add at least one test asserting “CLI parity” at a contract level (same inputs → same SQL or same validation result), where feasible without live LLM.

**Demo:** CI runs pass; tests fail if contract fields change unintentionally.

## 6 — Documentation + example consumer

1. Add minimal usage docs (curl + small Node example).
2. Cross-link Phase 3 spec from `docs/roadmap.md` and any integration notes (reuse-core guidance).

**Demo:** A new integrator can run the server and make a request in under 5 minutes.

