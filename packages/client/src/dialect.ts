import {
  isBuiltInDialectId,
  SUPPORTED_DIALECT_IDS,
  type AnyNormalizedSchema,
  type AskDialectInput,
  type BuiltInDialectId,
} from "@askdb/core";
import { DialectNotSupportedError } from "./errors.js";

export type DialectResolution = {
  dialect: AskDialectInput;
  source: "override" | "config" | "schema" | "default";
  /** Set when config.dialect and schema.provider disagree (config wins). */
  note?: string;
};

/**
 * The dialect `createAskDb()`'s `ask()` uses for `schema`, as the CLI, the HTTP API and Studio
 * resolve it: `override`, then `configDialect` (askdb.config's `dialect`, or
 * `createAskDb({ dialect })`), then the schema's `provider` when it's a built-in dialect id,
 * then `"postgres"` for a schema with no `provider`.
 *
 * A `provider` AskDB ships no dialect for throws {@link DialectNotSupportedError}, naming the
 * provider and the `dialect` key that overrides it, unless `unknownDialect` is
 * `"fallback-postgres"`. Checking SQL for one engine under another's rules can pass SQL the real
 * engine reads differently (ADR 0039).
 */
export function resolveDialect(
  schema: AnyNormalizedSchema,
  options: {
    override?: AskDialectInput;
    configDialect?: BuiltInDialectId;
    unknownDialect?: "throw" | "fallback-postgres";
  } = {},
): DialectResolution {
  const { override, configDialect, unknownDialect } = options;
  if (override) return { dialect: override, source: "override" };
  const provider = "provider" in schema && typeof schema.provider === "string" ? schema.provider : undefined;
  if (configDialect) {
    if (provider && provider !== configDialect) {
      return {
        dialect: configDialect,
        source: "config",
        note: `Using config dialect '${configDialect}'; schema declared provider '${provider}'.`,
      };
    }
    return { dialect: configDialect, source: "config" };
  }
  if (provider) {
    if (!isBuiltInDialectId(provider)) {
      if (unknownDialect === "fallback-postgres") {
        return {
          dialect: "postgres",
          source: "default",
          note: `Schema declared provider '${provider}' with no shipped DialectSpec; defaulting to 'postgres'.`,
        };
      }
      throw new DialectNotSupportedError(
        provider,
        `Schema declares provider '${provider}', but AskDB does not yet ship a DialectSpec for it.\n` +
          `Hint: set \`dialect: "postgres"\` (or another supported id) in askdb.config.* to override. ` +
          `Supported: ${SUPPORTED_DIALECT_IDS.join(", ")}.`,
      );
    }
    return { dialect: provider, source: "schema" };
  }
  return { dialect: "postgres", source: "default" };
}
