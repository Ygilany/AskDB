import type { AiConfig } from "./provider.js";

/**
 * Thrown when a model base URL carries a user name or password. `fetch` refuses such a URL, and
 * its own error quotes the whole URL, credentials included, so AskDB refuses it first. The
 * message names `setting` (the env variable it came from, or `baseURL` for an `AiConfig`) and
 * never repeats the URL.
 */
export class AiBaseUrlCredentialsError extends Error {
  readonly setting: string;

  constructor(setting: string) {
    super(
      `${setting} contains a username or password, which AskDB won't send in a URL. ` +
        "Put the key in the provider's API key setting; to send other credentials, such as a proxy's, " +
        "build the model in code with the AI SDK provider's headers option.",
    );
    this.name = "AiBaseUrlCredentialsError";
    this.setting = setting;
  }
}

/**
 * True when `url` names a user or password. A value that doesn't parse as a URL counts when it
 * holds an `@`, since it may still carry one; `fetch` would quote it whole as well.
 */
function hasCredentials(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.username !== "" || parsed.password !== "";
  } catch {
    return url.includes("@");
  }
}

/** Throws {@link AiBaseUrlCredentialsError} when `url` carries a user name or password. */
export function refuseBaseUrlCredentials(url: string | undefined, setting: string): void {
  if (url !== undefined && hasCredentials(url)) throw new AiBaseUrlCredentialsError(setting);
}

/** `{ baseURL }` for an AI SDK provider factory, once the URL is known to carry no credentials. */
export function baseURLOption(config: AiConfig): { baseURL?: string } {
  refuseBaseUrlCredentials(config.baseURL, "baseURL");
  return config.baseURL ? { baseURL: config.baseURL } : {};
}
