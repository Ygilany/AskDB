/**
 * Built-in providers load their AI SDK package (`@ai-sdk/openai`, …) lazily,
 * the first time they build a model. Those packages are optional peer
 * dependencies of `@askdb/ai`, so installing `@askdb/ai` never pulls in every
 * provider SDK — only the ones the host app installs.
 *
 * Each provider writes the import as a literal with the handler chained on it:
 *
 *     await import("@ai-sdk/google").catch(rethrowMissingPeer("google", PEER_PACKAGE))
 *
 * The `.catch()` must sit on the `import()` expression itself (or the `import()`
 * must sit lexically inside a `try`). That is how bundlers such as esbuild tell
 * an optional import from a required one: they bundle the SDK when it's
 * installed and leave the specifier for runtime when it isn't, instead of
 * failing the build. Passing `() => import(...)` into a helper hides the
 * handler from the bundler. Keep these calls inside functions: a top-level
 * `await import()` would make `@askdb/ai` impossible to `require()` from
 * CommonJS.
 */

/**
 * Returns a `.catch()` handler for a built-in provider's `import()` of its
 * optional peer SDK. When the import failed because `peerPackage` itself can't
 * be resolved, it throws an actionable install message. Any other failure
 * (including a missing transitive dependency *of* the peer) is rethrown
 * unchanged so the real cause stays visible.
 */
export function rethrowMissingPeer(provider: string, peerPackage: string): (error: unknown) => never {
  return (error) => {
    if (isMissingModule(error, peerPackage)) {
      throw new Error(
        `Provider '${provider}' requires the optional peer dependency ${peerPackage}. ` +
          `Install it: npm i ${peerPackage}`,
        { cause: error },
      );
    }
    throw error;
  };
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
