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
   * `() => import("pg").catch(rethrowDriverImportError)` written in the engine package, not
   * here: the peer is declared (and installed next to) the engine package, and
   * bundlers only see the dependency when the import is lexically in that
   * package. The `.catch()` chained on the `import()` (any handler that
   * rethrows the error unchanged) is how bundlers such as esbuild tell an
   * optional import from a required one; the catch inside this loader is
   * invisible to them.
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
   * carrying `missingMessage` when the peer is missing everywhere, and with an
   * `AskDbError` naming the real failure (`cause` set) when the peer is
   * installed but fails to load.
   */
  load(options?: DriverLoadOptions): Promise<T>;
};

/**
 * True when `cause` (or any error in its `cause` chain) is a Node module
 * resolution failure (`ERR_MODULE_NOT_FOUND` / `MODULE_NOT_FOUND`) for the
 * driver itself: the specifier Node could not find (`Cannot find package 'pg'`,
 * `Cannot find module 'mysql2/promise'`, or Yarn PnP's `tried to access pg`)
 * must be `packageName` or `specifier`, the entry point the loader asks for
 * (default `packageName`). A different missing package whose name merely
 * contains it (`pg-connection-string`), a path that happens to contain it
 * (`/home/mssqluser/…`), or another file of the package (`pg/lib/missing`,
 * which the installed driver failed to load) does not count. Anything else is a
 * real error and must surface.
 */
export function isModuleResolutionFailure(
  cause: unknown,
  packageName: string,
  specifier: string = packageName,
): boolean {
  if (!(cause instanceof Error)) return false;
  const nestedCause = (cause as { cause?: unknown }).cause;
  if (nestedCause && nestedCause !== cause && isModuleResolutionFailure(nestedCause, packageName, specifier)) {
    return true;
  }
  const code = (cause as { code?: unknown }).code;
  if (code !== "ERR_MODULE_NOT_FOUND" && code !== "MODULE_NOT_FOUND") return false;
  const missing =
    // Node: `Cannot find package 'pg' imported from …` / `Cannot find module 'mysql2/promise'`.
    /Cannot find (?:module|package) '([^']+)'/.exec(cause.message)?.[1] ??
    // Yarn PnP: `… tried to access pg, but it isn't declared in its dependencies …`.
    /tried to access ([^\s,]+)/.exec(cause.message)?.[1];
  return missing === packageName || missing === specifier;
}

/** The driver resolves from neither the engine package nor `resolveFrom`. */
class DriverNotFoundError extends AggregateError {}

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
      if (!isModuleResolutionFailure(cause, packageName, specifier)) throw cause;

      const fromDir = options?.resolveFrom ?? process.cwd();
      const projectRequire = createRequire(join(fromDir, "package.json"));
      let resolved: string;
      try {
        resolved = projectRequire.resolve(specifier);
      } catch (projectCause) {
        if (!isModuleResolutionFailure(projectCause, packageName, specifier)) throw projectCause;
        throw new DriverNotFoundError(
          [cause, projectCause],
          `Unable to resolve optional \`${packageName}\` peer dependency`,
        );
      }
      // Resolved in the project: any failure from here on is the installed
      // driver failing to load, never "not installed".
      return (await import(pathToFileURL(resolved).href)) as T;
    }
  }

  return {
    load(options) {
      const key = options?.resolveFrom;
      let promise = cache.get(key);
      if (!promise) {
        promise = importOptional(options).catch((cause: unknown) => {
          cache.delete(key);
          // Only a driver that resolves nowhere gets the install hint. A driver
          // that is installed but fails to load (a missing dependency of its
          // own, a native build error, …) reports that failure instead.
          if (cause instanceof DriverNotFoundError) throw new AskDbError(missingMessage, cause);
          const detail = cause instanceof Error ? cause.message : String(cause);
          throw new AskDbError(`The optional \`${packageName}\` peer dependency failed to load: ${detail}`, cause);
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
 * The install hint the first-party engines' built-in catalog runners throw when
 * their driver peer is missing, e.g.
 * `missingDriverMessage({ engine: "Postgres", packageName: "pg" })`. It
 * suggests a one-off `askdb` command, and the `askdb` binary registers only the
 * first-party engines, so a third-party engine writes its own `missingMessage`.
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

/**
 * The handler an engine chains on its driver's `import()`:
 * `() => import("pg").catch(rethrowDriverImportError)`. It rethrows unchanged,
 * so the loader still classifies the error; its job is to sit on the
 * `import()` expression, which is how bundlers such as esbuild tell an
 * optional peer from a required one.
 */
export function rethrowDriverImportError(error: unknown): never {
  throw error;
}
