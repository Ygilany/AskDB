import { ASKDB_AI_PROVIDERS, type AskDbAiProviderId } from "../constants.js";

/** An env var a scaffolded config reads through `env()`. */
export type AskDbScaffoldEnvVar = {
  name: string;
  /** Short description for `.env.example` and setup UIs. */
  purpose: string;
};

export type AskDbAiConfigScaffoldInput = {
  provider: AskDbAiProviderId;
  /** Env var NAME for the API key. */
  keyEnv: string;
  /** Env var NAME for the model (the deployment name on Azure). Omit to use the provider's default model. */
  modelEnv?: string;
};

export type AskDbAiConfigScaffold = {
  /** The `ai: { … },` property, indented for the top level of `defineConfig({ … })`. */
  source: string;
  /** Every env var `source` reads, in order. */
  envVars: AskDbScaffoldEnvVar[];
};

function isAiProvider(provider: string): provider is AskDbAiProviderId {
  return (ASKDB_AI_PROVIDERS as readonly string[]).includes(provider);
}

/**
 * Env var the scaffold reads `resourceName` from. It's also the name the Azure
 * adapter reads when there's no config file.
 */
const AZURE_RESOURCE_NAME_ENV = "AZURE_RESOURCE_NAME";

/**
 * Renders the `ai` block of a new `askdb.config.ts`, plus the env vars it
 * reads. `askdb init` and Studio's setup wizard both call this, so the fields
 * a provider needs to start (e.g. Azure's `resourceName`) live in one place.
 *
 * Every value is emitted as a JSON string literal: the generated file is
 * executed when the config loads, so a raw quote in a name must not inject code.
 */
export function renderAskDbAiConfigScaffold(input: AskDbAiConfigScaffoldInput): AskDbAiConfigScaffold {
  const { provider, keyEnv, modelEnv } = input;
  // The provider id is emitted as an object key, so only known ids get through.
  if (!isAiProvider(provider)) {
    throw new Error(`Unknown AI provider: ${JSON.stringify(provider)}`);
  }
  const envVars: AskDbScaffoldEnvVar[] = [{ name: keyEnv, purpose: `${provider} API key` }];
  const fields = [`apiKey: env(${JSON.stringify(keyEnv)}),`];
  if (modelEnv) {
    envVars.push({ name: modelEnv, purpose: `${provider} model override` });
    fields.push(`model: env(${JSON.stringify(modelEnv)}),`);
  }
  // `AzureConfig` / `FoundryConfig` need `resourceName` or `baseUrl`; the
  // adapter refuses to start without one. Scaffold the resource-name form.
  if (provider === "azure" || provider === "foundry") {
    envVars.push({
      name: AZURE_RESOURCE_NAME_ENV,
      purpose: 'Azure resource name, e.g. "my-resource" for https://my-resource.openai.azure.com',
    });
    fields.push(`resourceName: env(${JSON.stringify(AZURE_RESOURCE_NAME_ENV)}),`);
  }
  const source = `  ai: {
    provider: ${JSON.stringify(provider)},
    providerConfig: {
      ${provider}: {
${fields.map((field) => `        ${field}`).join("\n")}
      },
    },
  },`;
  return { source, envVars };
}
