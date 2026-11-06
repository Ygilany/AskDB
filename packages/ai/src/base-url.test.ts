import { describe, expect, it } from "vitest";
import {
  AiBaseUrlCredentialsError,
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

  it.each<[string, AiProviderAdapter, boolean]>([
    ["openai", openaiProvider, true],
    ["anthropic", anthropicProvider, false],
    ["google", googleProvider, true],
    ["azure", azureProvider, true],
    ["gateway", gatewayProvider, true],
  ])("%s: building a model refuses one in an AiConfig, naming baseURL", async (_name, adapter, embeds) => {
    // A gateway model id names its upstream provider.
    const model = adapter === gatewayProvider ? "openai/gpt-4o-mini" : "m";
    const config: AiConfig = { provider: adapter.provider, apiKey: "k", model, baseURL: WITH_CREDENTIALS };
    expectRefused(await failure(() => adapter.createLanguageModel(config)), "baseURL");
    if (embeds) expectRefused(await failure(() => adapter.createEmbeddingModel(config)), "baseURL");
  });

  it("refuses a URL that doesn't parse but has an @, since it may still carry a password", async () => {
    const env = { OPENAI_API_KEY: "k", OPENAI_BASE_URL: "http://admin:S3 cret@proxy.example/v1" };
    expectRefused(await failure(() => openaiProvider.resolveConfig(env, { usage: "language" })), "OPENAI_BASE_URL");
  });

  it("keeps a base URL without credentials, including one with an @ only in its path", () => {
    const env = { OPENAI_API_KEY: "k", OPENAI_BASE_URL: "https://proxy.example/v1/@team" };
    expect(openaiProvider.resolveConfig(env, { usage: "language" })?.baseURL).toBe("https://proxy.example/v1/@team");
  });
});
