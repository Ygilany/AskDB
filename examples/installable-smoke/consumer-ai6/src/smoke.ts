/**
 * AI SDK 6 compatibility smoke for `@askdb/core`.
 *
 * `ai` is a peer dependency of `@askdb/core` (`^6 || ^7`), so a host that is
 * still on AI SDK 6 (with `@ai-sdk/openai@3`) must be able to install the
 * packed core tarball without ERESOLVE, type-check a provider model against
 * `AskDbLanguageModel`, and run `ask()` through the real AI SDK 6
 * `generateText` — with the NL→SQL system prompt actually reaching the model.
 * `@askdb/rag`'s AI SDK embedder is exercised through AI SDK 6's `embedMany`.
 */
import { existsSync, readFileSync } from "node:fs";
import { createOpenAI } from "@ai-sdk/openai";
import { MockEmbeddingModelV3, MockLanguageModelV3 } from "ai/test";
import {
  ask,
  loadNormalizedSchemaFromJson,
  loadSchemaFromJson,
  type AskDbLanguageModel,
} from "@askdb/core";
import { buildSchemaIndex, createAiSdkEmbedder, createMemoryStore } from "@askdb/rag";

const aiVersion = (
  JSON.parse(readFileSync(new URL("../node_modules/ai/package.json", import.meta.url), "utf8")) as {
    version: string;
  }
).version;
if (!aiVersion.startsWith("6.")) {
  throw new Error(`smoke(ai6): expected ai@6 to be installed, got ai@${aiVersion}`);
}
// Core must share the host's `ai` instance rather than nesting its own copy.
if (existsSync(new URL("../node_modules/@askdb/core/node_modules/ai", import.meta.url))) {
  throw new Error("smoke(ai6): @askdb/core installed a nested copy of `ai`");
}

// Type-level: an AI SDK 6 provider model is assignable to core's model contract.
// Constructing the model does not make a network call.
const providerModel: AskDbLanguageModel = createOpenAI({ apiKey: "sk-smoke" })("gpt-4o-mini");
void providerModel;

const fakeSql = "SELECT COUNT(*) AS n FROM users";

async function main(): Promise<void> {
  const schema = loadNormalizedSchemaFromJson(
    JSON.stringify({
      version: 1,
      tables: [
        {
          name: "users",
          columns: [{ name: "id", type: "uuid", nullable: false, primaryKey: true }],
        },
      ],
    }),
  );

  const model = new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [{ type: "text", text: `\`\`\`sql\n${fakeSql}\n\`\`\`` }],
      finishReason: { unified: "stop", raw: undefined },
      usage: {
        inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 5, text: 5, reasoning: undefined },
      },
      warnings: [],
    }),
  });

  const out = await ask({
    question: "How many users are there?",
    schema,
    model,
    dialect: "postgres",
    parameterize: false,
  });
  if (out.sql !== fakeSql) {
    throw new Error(`smoke(ai6): expected ${JSON.stringify(fakeSql)}, got ${JSON.stringify(out.sql)}`);
  }

  // Before core switched from `instructions` to `system`, AI SDK 6 silently
  // dropped the system prompt. Assert it reaches the model.
  const prompt = model.doGenerateCalls[0]?.prompt ?? [];
  const system = prompt.find((message) => message.role === "system");
  if (typeof system?.content !== "string" || !system.content.includes("AskDB SQL generator")) {
    throw new Error("smoke(ai6): the NL→SQL system prompt did not reach the model via AI SDK 6");
  }

  // @askdb/rag: AI SDK 6 embedding model -> createAiSdkEmbedder -> embedMany.
  const embeddingModel = new MockEmbeddingModelV3({
    doEmbed: async ({ values }) => ({
      embeddings: values.map((value) => [value.length, 1]),
      warnings: [],
    }),
  });
  const v2Schema = loadSchemaFromJson(
    JSON.stringify({
      version: 2,
      schemaId: "smoke-ai6",
      tables: [
        {
          id: "table:public.users",
          name: "users",
          schema: "public",
          columns: [
            { id: "table:public.users#id", name: "id", type: "uuid", nullable: false, primaryKey: true },
          ],
        },
      ],
    }),
  );
  const index = await buildSchemaIndex({
    schema: v2Schema,
    embedder: createAiSdkEmbedder({ model: embeddingModel }),
    store: createMemoryStore(),
    embedderId: "smoke:ai6-mock",
  });
  if (index.stats.chunksTotal === 0 || embeddingModel.doEmbedCalls.length === 0) {
    throw new Error("smoke(ai6): @askdb/rag did not embed through AI SDK 6");
  }

  console.log(`smoke(ai6): ok - @askdb/core ask() and @askdb/rag embeddings ran on ai@${aiVersion}`);
}

main().catch((e: unknown) => {
  console.error("smoke(ai6): FAILED");
  console.error(e);
  process.exit(1);
});
