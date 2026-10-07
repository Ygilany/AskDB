/**
 * Live-model mode, `LAB_LIVE_MODEL=1 pnpm lab:matrix` (#247): a real OpenAI model answers the
 * lab's questions, over the network, through both documented model paths, and the results
 * suite's oracle grades whatever SQL it writes. Nothing is written to `cassettes/`.
 *
 * This file runs only with `LAB_LIVE_MODEL=1` (`vitest.config.ts` leaves it out otherwise), so
 * CI, which never sets it, never runs it; and with it set in CI, or without a key, every test
 * fails with the reason instead of falling back to the replay model (`src/model/live.ts`).
 *
 * Each answer is a verdict (`src/grade.ts`), shown in the matrix as:
 *
 * - `pass`: the SQL `ask()` returned, run as the host, returned the oracle's rows (for a guarantee
 *   question: the guarantee held);
 * - `miss (<path>: <reason>)`: model quality, not a product failure: a validation rejection, SQL
 *   the engine refused, or other rows. The test passes and records the miss as an annotation;
 * - `FAIL`: a guarantee violation, SQL that passed AskDB's checks but was refused by the host as
 *   a write (read-only), returned another tenant's rows (tenant), or returned seeded sensitive
 *   values in strict mode (sensitive). A product failure, to be filed. A failed model call (a bad
 *   key, a quota, an outage) is a `FAIL` too, never a miss; its reason says which.
 *
 * Every answer, with its SQL and reason, is also written to `.lab/live-answers.json`, with the
 * model's whole reply on the raw path (read through the AI SDK's documented `fetch` option), so a
 * rejection, which carries no SQL, can still be judged.
 *
 * Contract: the full path with a real provider works on every engine: the prompt goes out over
 * the network, and the reply comes back and is extracted, validated, bound and executed, through
 * the raw-model path (`createOpenAI()` → `ask()`, `guides/bring-your-own-model.mdx`) and the
 * adapter path (`createAskDb` with `@askdb/ai-openai` from config, `reference/client-api.mdx`).
 * And AskDB's guarantees hold for SQL a real model writes: tenant scoping
 * (`guides/multi-tenancy.mdx`) and strict sensitive-column checks
 * (`docs/contracts/sensitive-fields-and-modes.md`), as well as read-only validation.
 * Catches: a provider wire format AskDB can no longer read (a reply the replay server's shape
 * hides); extraction or binding that breaks on how real models format replies; key or base-URL
 * resolution in the adapter path against the real API; and a guarantee a hand-written attacker
 * reply never thought to test.
 * Not covered elsewhere: every other suite replays hand-written or reviewed replies from a local
 * server; `lab:record` asks through the raw path only, via its proxy.
 * No production seam: the model paths, `tenantScope`, `sensitiveGuardrailMode` and the errors
 * are documented; the oracles are lab code computed from the seed data.
 *
 * The tenant and sensitive questions are asked through the raw path only: their enforcement is
 * in `ask()`, which both paths share, and the catalog questions already cover the adapter path.
 * The adapter path uses `@askdb/ai-openai`, deprecated on `main` but the documented adapter on
 * the releases the lab also targets (`npm:latest`), as `lab ask --via client` does.
 * A tenant answer whose columns differ from the oracle's can't be checked for a leak from its
 * rows; its miss says the scope is unchecked.
 *
 * Needs the fixture, an installed lab, `OPENAI_API_KEY` (shell or `.env.live`), and the
 * capabilities the replay suites need for the same questions.
 */
import { createOpenAI } from "@ai-sdk/openai";
import { openaiProvider } from "@askdb/ai-openai";
import { createAskDb } from "@askdb/client";
import { bootstrapAskDbEnv, getAskDbRuntimeConfig } from "@askdb/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, type TestContext } from "vitest";
import { askWithModel, settle, type AskResult } from "../src/ask.js";
import { ensureArtifact } from "../src/artifacts.js";
import { needsCapability } from "../src/capabilities.js";
import { SUPPORTED_DIALECTS, type SupportedDialect } from "../src/dialects.js";
import { gradeCatalogAnswer, gradeSensitiveAnswer, gradeTenantAnswer, type Verdict } from "../src/grade.js";
import { loadQuestions } from "../src/model/catalog.js";
import { replyText } from "../src/model/openai-wire.js";
import { DEFAULT_LIVE_MODEL_ID, liveSettings, redact, type LiveSettings } from "../src/model/live.js";
import { LAB_ROOT, LAB_STATE } from "../src/paths.js";
import { removeSensitiveArtifact, sensitiveArtifact } from "../src/sensitive.js";
import { idsScope, removeTenantArtifact, tenantArtifact } from "../src/tenant.js";

const LIVE_PROJECT = join(LAB_ROOT, "live");
const QUESTIONS = loadQuestions();
const TENANT_QUESTIONS = loadQuestions(join(LAB_ROOT, "scenarios", "tenant-questions.json"));
const SENSITIVE_QUESTIONS = loadQuestions(join(LAB_ROOT, "scenarios", "sensitive-questions.json"));
/** The tenant questions a tenant asks honestly; the others are worded as the attacker for the replay suite. */
const SCOPED = ["tenant-programs", "tenant-client-agencies", "tenant-order-line-counts", "tenant-payments-per-agency", "tenant-programs-since"];
/** The sensitive question that names no sensitive column: strict mode must answer it. */
const SENSITIVE_CONTROL = "sensitive-client-names";
/** The flat scope the tenant questions are asked under. */
const AGENCY = 2;
const VIAS = ["raw", "client"] as const;
type Via = (typeof VIAS)[number];

let settings: LiveSettings;
const answers: { dialect: string; scenario: string; via: string; verdict: Verdict; reply?: string | null }[] = [];
const artifacts: { dir: string; remove: (dir: string) => void }[] = [];

beforeAll(() => {
  // Throws in CI or without a key: every test then fails with that message.
  settings = liveSettings("live mode");
  // For the adapter path's config (`live/askdb.config.ts`), which reads both from the environment:
  // this test file's own worker, which ends with the run.
  process.env.OPENAI_API_KEY = settings.apiKey;
  if (settings.modelId !== DEFAULT_LIVE_MODEL_ID) process.env.LAB_LIVE_MODEL_ID = settings.modelId;
  bootstrapAskDbEnv({ cwd: LIVE_PROJECT });
});

afterAll(() => {
  for (const { dir, remove } of artifacts) remove(dir);
  if (!answers.length) return;
  mkdirSync(LAB_STATE, { recursive: true });
  const sorted = [...answers].sort((a, b) => `${a.scenario}/${a.dialect}/${a.via}`.localeCompare(`${b.scenario}/${b.dialect}/${b.via}`));
  writeFileSync(join(LAB_STATE, "live-answers.json"), `${JSON.stringify({ model: settings?.modelId, generatedAt: new Date().toISOString(), answers: sorted }, null, 2)}\n`);
});

interface Asked {
  answer: Promise<AskResult>;
  /** The model's whole reply, on the raw path, once the call is done. */
  reply: () => string | null;
}

/** `ask()` on the live model through one of the two documented paths. */
function askLive(via: Via, dialect: SupportedDialect, question: string, schemaDir: string, extras = {}): Asked {
  if (via === "client") {
    // The dialect is passed explicitly: MariaDB is introspected with the MySQL engine.
    const answer = createAskDb({ config: getAskDbRuntimeConfig(), providers: [openaiProvider], schema: { path: schemaDir }, dialect }).ask(question);
    return { answer, reply: () => null };
  }
  let reply: string | null = null;
  const openai = createOpenAI({
    apiKey: settings.apiKey,
    fetch: async (input, init) => {
      const response = await fetch(input, init);
      reply = replyText((await response.clone().json().catch(() => ({}))) as Record<string, unknown>);
      return response;
    },
  });
  return { answer: askWithModel(dialect, question, schemaDir, openai(settings.modelId), extras), reply: () => reply };
}

/**
 * A verdict, or the error that made the answer ungradable (a failed model call) rethrown with
 * anything shaped like a key redacted: providers echo part of a rejected key in their message.
 */
function graded(verdict: Promise<Verdict>): Promise<Verdict> {
  return verdict.catch((error: unknown) => {
    throw new Error(redact(error instanceof Error ? `${error.name}: ${error.message}` : String(error), settings.apiKey));
  });
}

/** A violation fails the test; a miss passes it, annotated so the matrix shows `miss (…)`. */
function report(ctx: TestContext, dialect: string, scenario: string, via: string, verdict: Verdict, reply: string | null): void {
  const scrub = (text: string) => redact(text, settings.apiKey);
  answers.push({ dialect, scenario, via, verdict: "sql" in verdict && verdict.sql ? { ...verdict, sql: scrub(verdict.sql) } : verdict, reply: reply && scrub(reply) });
  if (verdict.status === "violation") ctx.expect.fail(`${verdict.guarantee} violation (${via}): ${verdict.reason}\n${verdict.sql}`);
  if (verdict.status === "miss") ctx.annotate(`${via}: ${verdict.reason}`, "miss");
}

/** An artifact built on first use, and removed when the file ends. */
function lazyArtifact(build: () => string, remove: (dir: string) => void): () => string {
  let dir: string | undefined;
  return () => {
    if (!dir) {
      dir = build();
      artifacts.push({ dir, remove });
    }
    return dir;
  };
}

describe.each(SUPPORTED_DIALECTS.map((d) => [d] as [SupportedDialect]))("[%s]", (dialect) => {
  const tenantDir = lazyArtifact(() => tenantArtifact(dialect, "strict"), removeTenantArtifact);
  const sensitiveDir = lazyArtifact(() => sensitiveArtifact(dialect), removeSensitiveArtifact);
  const needsSchemas = (ctx: TestContext) => {
    needsCapability(ctx, "cli-introspect-engine");
    if (dialect === "mysql" || dialect === "mariadb") needsCapability(ctx, "mysql-databases");
  };

  it.concurrent.for(QUESTIONS.flatMap((q) => VIAS.map((via) => [q.id, via, q.text] as const)))(
    "live-%s: through the %s path, the live model's SQL returns the oracle's rows",
    async ([id, via, text], ctx) => {
      needsCapability(ctx, "cli-introspect-engine");
      const asked = askLive(via, dialect, text, ensureArtifact(dialect));
      report(ctx, dialect, `live-${id}`, via, await graded(gradeCatalogAnswer(dialect, id, await settle(asked.answer))), asked.reply());
    },
  );

  it.concurrent.for(SCOPED.map((id) => [id, TENANT_QUESTIONS.find((q) => q.id === id)!.text] as const))(
    `live-%s: scoped to agency ${AGENCY}, the live model's SQL returns no other agency's rows`,
    async ([id, text], ctx) => {
      needsSchemas(ctx);
      const asked = askLive("raw", dialect, text, tenantDir(), { tenantScope: idsScope(dialect, [AGENCY]), tenantSqlMode: "sql-only" });
      report(ctx, dialect, `live-${id}`, "raw", await graded(gradeTenantAnswer(dialect, id, await settle(asked.answer), [AGENCY])), asked.reply());
    },
  );

  it.concurrent.for(SENSITIVE_QUESTIONS.map((q) => [q.id, q.text] as const))(
    "live-%s: in strict mode, the live model's SQL returns no seeded sensitive value",
    async ([id, text], ctx) => {
      needsSchemas(ctx);
      const asked = askLive("raw", dialect, text, sensitiveDir(), { sensitiveGuardrailMode: "strict" });
      report(ctx, dialect, `live-${id}`, "raw", await graded(gradeSensitiveAnswer(dialect, await settle(asked.answer), id === SENSITIVE_CONTROL)), asked.reply());
    },
  );
});
