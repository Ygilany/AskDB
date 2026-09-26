import { AskDbError } from "@askdb/core";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Where to resolve an optional driver peer from when the engine package itself
 * cannot see it. Defaults to `process.cwd()` — the caller's project root.
 */
export type DriverLoadOptions = { resolveFrom?: string };

export type OptionalDriverSpec<T> = {
  /** npm package name of the optional peer (e.g. `"pg"`, `"mysql2"`). */
  packageName: string;
  /**
   * Module specifier to import when falling back to the project root. Defaults
   * to `packageName`; set it for subpath entry points such as `"mysql2/promise"`.
   */
  specifier?: string;
  /**
   * Imports the driver relative to the *engine package*. Must be a literal
   * `() => import("pg")` written in the engine package, not here: the peer is
   * declared (and installed next to) the engine package, and bundlers only
   * see the dependency when the import is lexically in that package.
   */
  importDriver: () => Promise<T>;
  /** Message of the `AskDbError` thrown when the peer cannot be resolved from anywhere. */
  missingMessage: string;
};

export type OptionalDriverLoader<T> = {
  /**
   * Resolve the driver: first through the engine package's own import, then
   * from `resolveFrom` (default `process.cwd()`). Successful loads are cached
   * per `resolveFrom`; failures clear the cache slot so a later call retries
   * (e.g. after the user runs `pnpm add pg`). Rejects with an `AskDbError`
   * carrying `missingMessage` when the peer is missing everywhere.
   */
  load(options?: DriverLoadOptions): Promise<T>;
};

/**
 * True when `cause` (or any error in its `cause` chain) is a Node module
 * resolution failure that names `packageName`. Anything else — a driver that
 * is installed but throws while loading — is a real error and must surface.
 */
export function isModuleResolutionFailure(cause: unknown, packageName: string): boolean {
  if (!(cause instanceof Error)) return false;
  const nestedCause = (cause as { cause?: unknown }).cause;
  if (nestedCause && nestedCause !== cause && isModuleResolutionFailure(nestedCause, packageName)) {
    return true;
  }
  const code = (cause as { code?: unknown }).code;
  if (code !== "ERR_MODULE_NOT_FOUND" && code !== "MODULE_NOT_FOUND") return false;
  return cause.message.includes(packageName);
}

/**
 * Build a lazy, cached loader for an optional database-driver peer. Engine
 * packages call this once at module scope, so each engine keeps its own cache.
 */
export function createOptionalDriverLoader<T>(spec: OptionalDriverSpec<T>): OptionalDriverLoader<T> {
  const { packageName, importDriver, missingMessage } = spec;
  const specifier = spec.specifier ?? packageName;
  const cache = new Map<string | undefined, Promise<T>>();

  async function importOptional(options?: DriverLoadOptions): Promise<T> {
    try {
      return await importDriver();
    } catch (cause) {
      if (!isModuleResolutionFailure(cause, packageName)) throw cause;

      const fromDir = options?.resolveFrom ?? process.cwd();
      const projectRequire = createRequire(join(fromDir, "package.json"));
      try {
        const resolved = projectRequire.resolve(specifier);
        return (await import(pathToFileURL(resolved).href)) as T;
      } catch (projectCause) {
        if (!isModuleResolutionFailure(projectCause, packageName)) throw projectCause;
        throw new AggregateError(
          [cause, projectCause],
          `Unable to resolve optional \`${packageName}\` peer dependency`,
        );
      }
    }
  }

  return {
    load(options) {
      const key = options?.resolveFrom;
      let promise = cache.get(key);
      if (!promise) {
        promise = importOptional(options).catch((cause) => {
          cache.delete(key);
          throw new AskDbError(missingMessage, cause);
        });
        cache.set(key, promise);
      }
      return promise;
    },
  };
}

/**
 * True when `packageName` resolves from `resolveFrom` (default `process.cwd()`).
 * A cheap, synchronous capability probe — it does not load the driver.
 */
export function isDriverInstalled(packageName: string, options?: DriverLoadOptions): boolean {
  try {
    const req = createRequire(join(options?.resolveFrom ?? process.cwd(), "package.json"));
    req.resolve(packageName);
    return true;
  } catch {
    return false;
  }
}

/**
 * The standard "optional peer missing" message used by the first-party engine
 * packages, e.g. `missingDriverMessage({ engine: "Postgres", packageName: "pg" })`.
 */
export function missingDriverMessage(input: { engine: string; packageName: string }): string {
  const { engine, packageName } = input;
  return (
    `The built-in ${engine} catalog query runner requires the optional \`${packageName}\` peer dependency. ` +
    `Install it in your project (e.g. \`pnpm add ${packageName}\`) or include it in the same one-off command ` +
    `(e.g. \`pnpm dlx -p askdb -p ${packageName} askdb ...\` or \`npx -p askdb -p ${packageName} askdb ...\`). ` +
    `You can also pass a custom catalog query runner to the ${engine} connector.`
  );
}
