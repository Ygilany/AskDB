import { afterEach, describe, expect, it } from "vitest";
import {
  AiBaseUrlCredentialsError,
  BUILTIN_AI_PROVIDERS,
  anthropicProvider,
  azureProvider,
  gatewayProvider,
  googleProvider,
  openaiProvider,
  type AiConfig,
  type AiProviderAdapter,
} from "./index.js";

// #787: fetch refuses a URL with a user name or password, and its error quotes the whole URL.
// AskDB refuses it first, naming where it came from and never repeating it.
const SECRET = /S3cret|admin/;
const WITH_CREDENTIALS = "http://admin:S3cret@proxy.example/v1";

async function failure(run: () => unknown): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  return undefined;
}

function expectRefused(error: unknown, setting: string): void {
  expect(error).toBeInstanceOf(AiBaseUrlCredentialsError);
  expect((error as AiBaseUrlCredentialsError).setting).toBe(setting);
  expect((error as Error).message).toMatch(new RegExp(`^${setting} contains a username or password`));
  expect((error as Error).message).not.toMatch(SECRET);
}

describe("a model base URL with credentials", () => {
  it.each<[string, AiProviderAdapter, Record<string, string>, string]>([
    ["openai", openaiProvider, { OPENAI_API_KEY: "k", OPENAI_BASE_URL: WITH_CREDENTIALS }, "OPENAI_BASE_URL"],
    ["anthropic", anthropicProvider, { ANTHROPIC_API_KEY: "k", ANTHROPIC_BASE_URL: WITH_CREDENTIALS }, "ANTHROPIC_BASE_URL"],
    ["google", googleProvider, { GOOGLE_GENERATIVE_AI_API_KEY: "k", GOOGLE_AI_BASE_URL: WITH_CREDENTIALS }, "GOOGLE_AI_BASE_URL"],
    ["azure", azureProvider, { AZURE_OPENAI_API_KEY: "k", AZURE_OPENAI_ENDPOINT: WITH_CREDENTIALS }, "AZURE_OPENAI_ENDPOINT"],
    ["gateway", gatewayProvider, { AI_GATEWAY_API_KEY: "k", ASKDB_AI_BASE_URL: WITH_CREDENTIALS }, "ASKDB_AI_BASE_URL"],
    ["the universal variable", openaiProvider, { OPENAI_API_KEY: "k", ASKDB_AI_BASE_URL: "https://admin@proxy.example/v1" }, "ASKDB_AI_BASE_URL"],
  ])("%s: resolving the config refuses one in an env variable, naming the variable", async (_name, adapter, env, setting) => {
    expectRefused(await failure(() => adapter.resolveConfig(env, { usage: "language" })), setting);
  });

  // Every row of the built-in table, so a provider added later fails here until it builds its
  // SDK options through baseURLOption.
  it.each(BUILTIN_AI_PROVIDERS.map((row) => [row.provider, row] as const))(
    "%s: building a model refuses one in an AiConfig, naming baseURL",
    async (_name, { adapter, env }) => {
      const config: AiConfig = { provider: adapter.provider, apiKey: "k", model: env.defaultModel, baseURL: WITH_CREDENTIALS };
      expectRefused(await failure(() => adapter.createLanguageModel(config)), "baseURL");
      const embedding = await failure(() => adapter.createEmbeddingModel(config));
      // Anthropic has no embedding model to build.
      if (!(embedding instanceof Error && /does not provide an embeddings API/.test(embedding.message))) expectRefused(embedding, "baseURL");
    },
  );

  it("refuses a URL that doesn't parse but has an @, since it may still carry a password", async () => {
    const env = { OPENAI_API_KEY: "k", OPENAI_BASE_URL: "http://admin:S3 cret@proxy.example/v1" };
    expectRefused(await failure(() => openaiProvider.resolveConfig(env, { usage: "language" })), "OPENAI_BASE_URL");
  });

  describe("the base URL variable a provider SDK reads from process.env when given none", () => {
    const saved = { ...process.env };
    afterEach(() => {
      process.env = { ...saved };
    });

    it.each<[string, AiProviderAdapter, string]>([
      ["openai", openaiProvider, "OPENAI_BASE_URL"],
      ["anthropic", anthropicProvider, "ANTHROPIC_BASE_URL"],
    ])("%s: building a model refuses a credentialed one, naming the variable", async (_name, adapter, variable) => {
      process.env[variable] = WITH_CREDENTIALS;
      const config: AiConfig = { provider: adapter.provider, apiKey: "k", model: "m" };
      expectRefused(await failure(() => adapter.createLanguageModel(config)), variable);
    });

    it("leaves it alone when the AiConfig sets its own baseURL, which the SDK uses instead", async () => {
      process.env.OPENAI_BASE_URL = WITH_CREDENTIALS;
      const config: AiConfig = { provider: "openai", apiKey: "k", model: "m", baseURL: "https://proxy.example/v1" };
      await expect(openaiProvider.createLanguageModel(config)).resolves.toBeDefined();
    });
  });

  it("keeps a base URL without credentials, including one with an @ only in its path", () => {
    const env = { OPENAI_API_KEY: "k", OPENAI_BASE_URL: "https://proxy.example/v1/@team" };
    expect(openaiProvider.resolveConfig(env, { usage: "language" })?.baseURL).toBe("https://proxy.example/v1/@team");
  });
});
