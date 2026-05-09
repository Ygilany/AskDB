import type { TabularResult } from "./postgres.js";

/**
 * BYO database execution seam for {@link import("../ask.js").ask}.
 *
 * Consumers supply a function that runs a generated read-only `SELECT` against their own
 * driver (e.g. `pg`, `postgres.js`, Neon HTTP, Cloudflare Hyperdrive, MCP-mediated DB) and
 * returns rows in the canonical {@link TabularResult} shape.
 *
 * Contract — see `docs/specs/phase-4-publish-npm/requirements.md` (“Executor seam — contract”):
 *
 * 1. **Read-only execution.** The consumer is responsible for ensuring the executor cannot perform
 *    writes. The built-in Postgres executor does this with `BEGIN READ ONLY` (see
 *    {@link import("./postgres.js").executeReadOnlySelect}). Custom executors should document their
 *    guarantee.
 * 2. **`TabularResult` shape stays stable** as part of the published `@askdb/core` contract.
 * 3. **Errors propagate.** Executor errors must throw or reject; the pipeline logs
 *    `askdb.pipeline.failed` with `phase: "execute"` and rethrows. No silent swallowing.
 * 4. **Mode boundaries unchanged.** The executor does not see modes; modes affect what happens
 *    *around* execution, not how SQL is run.
 *
 * The `params` argument is reserved for future parameterized SQL (NL→SQL is parameter-free
 * today); custom executors may accept it as `undefined`.
 */
export type AskDbExecutor = (
  sql: string,
  params?: ReadonlyArray<unknown>,
) => Promise<TabularResult>;
