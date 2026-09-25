/**
 * Built-in providers load their AI SDK package (`@ai-sdk/openai`, …) lazily,
 * the first time they build a model. Those packages are optional peer
 * dependencies of `@askdb/ai`, so installing `@askdb/ai` never pulls in every
 * provider SDK — only the ones the host app installs.
 *
 * The loader is always a literal `() => import("<pkg>")` at the call site so
 * bundlers can still see (and, if the package is installed, resolve) the
 * specifier. Keep these calls inside functions: a top-level `await import()`
 * would make `@askdb/ai` impossible to `require()` from CommonJS.
 */

/** Actionable message for a built-in provider whose optional peer SDK is not installed. */
export function optionalPeerMissingMessage(provider: string, peerPackage: string): string {
  return (
    `Provider '${provider}' requires the optional peer dependency ${peerPackage}. ` +
    `Install it: npm i ${peerPackage}`
  );
}

/**
 * Runs `load` and, when it fails because `peerPackage` itself cannot be
 * resolved, rethrows with {@link optionalPeerMissingMessage}. Any other
 * failure (including a missing transitive dependency *of* the peer) is
 * rethrown unchanged so the real cause stays visible.
 */
export async function importOptionalPeer<T>(
  provider: string,
  peerPackage: string,
  load: () => Promise<T>,
): Promise<T> {
  try {
    return await load();
  } catch (error) {
    if (isMissingModule(error, peerPackage)) {
      throw new Error(optionalPeerMissingMessage(provider, peerPackage), { cause: error });
    }
    throw error;
  }
}

function isMissingModule(error: unknown, peerPackage: string): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: unknown }).code;
  if (code !== "ERR_MODULE_NOT_FOUND" && code !== "MODULE_NOT_FOUND") return false;
  // Node: "Cannot find package '@ai-sdk/google' imported from …" (ESM) or
  // "Cannot find module '@ai-sdk/google'" (CJS). Only claim the peer is
  // missing when the unresolved specifier is the peer itself.
  return (
    error.message.includes(`'${peerPackage}'`) || error.message.includes(`"${peerPackage}"`)
  );
}
