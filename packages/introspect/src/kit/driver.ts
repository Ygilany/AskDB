import { AskDbError } from "@askdb/core";
import { existsSync, readFileSync, statSync } from "node:fs";
import Module, { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
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
   *
   * Node 24 and later can keep a failed package lookup until the process exits,
   * so a retry may still miss a peer installed after the first attempt (#669).
   * When the peer is on disk under `resolveFrom` (or on `NODE_PATH`) but Node
   * can't resolve it, the loader reads its entry from its `package.json` and
   * imports that file by path. Only when it can't find the entry that way does
   * the `AskDbError` say to restart the process.
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
function isModuleResolutionFailure(
  cause: unknown,
  packageName: string,
  specifier: string = packageName,
): boolean {
  if (!(cause instanceof Error)) return false;
  const nestedCause = cause.cause;
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

/** Node can't resolve the driver, but it is on disk in `nodeModules` (see `OptionalDriverLoader.load`). */
class DriverUnresolvableError extends AggregateError {
  constructor(
    errors: unknown[],
    readonly nodeModules: string,
  ) {
    super(errors, "Optional peer dependency is installed but does not resolve");
  }
}

/**
 * The directories Node searches after a module's own `node_modules` chain: the
 * `NODE_PATH` entries, then `~/.node_modules`, `~/.node_libraries` and
 * `<prefix>/lib/node`, as Node read them at startup. `Module.globalPaths` is
 * Node's public copy of that list (untyped in `@types/node`); reading it keeps
 * `process.env` out of this package (ADR 0005).
 */
function globalModuleDirs(): readonly string[] {
  const paths = (Module as unknown as { globalPaths?: unknown }).globalPaths;
  return Array.isArray(paths) ? paths.filter((p): p is string => typeof p === "string" && p !== "") : [];
}

/**
 * The `node_modules` directory that holds `packageName`: under `fromDir` or one
 * of its parents, then in Node's global directories (`NODE_PATH` first), as
 * Node searches. Checked on disk, never through Node's resolver, which on Node
 * 24+ would keep a miss (#669).
 */
function nodeModulesHolding(fromDir: string, packageName: string): string | undefined {
  const holds = (nodeModules: string) => existsSync(join(nodeModules, packageName, "package.json"));
  for (let dir = resolve(fromDir); ; dir = dirname(dir)) {
    if (holds(join(dir, "node_modules"))) return join(dir, "node_modules");
    if (dirname(dir) === dir) break;
  }
  return globalModuleDirs().find(holds);
}

/** The conditions Node's `require` resolves with (`module-sync` on Node 22.12+), which the project fallback below uses too. */
const REQUIRE_CONDITIONS = new Set(["node", "module-sync", "require", "default"]);

/** An `exports` target under {@link REQUIRE_CONDITIONS}: a string, the first match in an array, or a nested condition map. */
function exportsTarget(target: unknown): string | undefined {
  if (typeof target === "string") return target;
  if (Array.isArray(target)) {
    for (const entry of target) {
      const found = exportsTarget(entry);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (target !== null && typeof target === "object") {
    for (const [condition, value] of Object.entries(target)) {
      if (!REQUIRE_CONDITIONS.has(condition)) continue;
      const found = exportsTarget(value);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

/** A file as `require` finds it: as written, with `.js`, `.cjs` or `.json`, or the directory's `index.js`. */
function existingFile(path: string): string | undefined {
  const isFile = (p: string) => existsSync(p) && statSync(p).isFile();
  for (const candidate of [path, `${path}.js`, `${path}.cjs`, `${path}.json`, join(path, "index.js")]) {
    if (isFile(candidate)) return candidate;
  }
  return undefined;
}

/**
 * The file `specifier` names inside the installed package at `packageDir`, read
 * from its `package.json` the way `require` would: its `exports` map (exact
 * subpaths only) or, with none, `main` for the package and the path itself for
 * a subpath. Undefined when it can't tell.
 */
function entryOnDisk(packageDir: string, packageName: string, specifier: string): string | undefined {
  let manifest: { exports?: unknown; main?: unknown };
  try {
    manifest = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
  } catch {
    return undefined;
  }
  const subpath = specifier === packageName ? "." : `.${specifier.slice(packageName.length)}`;
  const { exports } = manifest;
  if (exports !== undefined && exports !== null) {
    const keyed = typeof exports === "object" && !Array.isArray(exports) && Object.keys(exports).some((k) => k.startsWith("."));
    const target = exportsTarget(keyed ? (exports as Record<string, unknown>)[subpath] : subpath === "." ? exports : undefined);
    return target?.startsWith("./") ? existingFile(join(packageDir, target)) : undefined;
  }
  if (subpath !== ".") return existingFile(join(packageDir, subpath));
  return existingFile(join(packageDir, typeof manifest.main === "string" ? manifest.main : "index.js"));
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
      if (!isModuleResolutionFailure(cause, packageName, specifier)) throw cause;

      const fromDir = options?.resolveFrom ?? process.cwd();
      const projectRequire = createRequire(join(fromDir, "package.json"));
      let resolved: string;
      try {
        resolved = projectRequire.resolve(specifier);
      } catch (projectCause) {
        if (!isModuleResolutionFailure(projectCause, packageName, specifier)) throw projectCause;
        const nodeModules = nodeModulesHolding(fromDir, packageName);
        if (nodeModules) {
          // On disk, but Node won't resolve it: on Node 24+, a lookup earlier in this process
          // missed and Node kept the miss (#669). Load the entry by path instead.
          const entry = entryOnDisk(join(nodeModules, packageName), packageName, specifier);
          if (entry === undefined) throw new DriverUnresolvableError([cause, projectCause], nodeModules);
          return (await import(pathToFileURL(entry).href)) as T;
        }
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
          if (cause instanceof DriverUnresolvableError) {
            throw new AskDbError(
              `\`${packageName}\` is in ${cause.nodeModules}, but Node can't load it in this process. ` +
                "If it was installed while the process was running, restart the process: " +
                "Node 24 and later can keep a failed package lookup until the process exits.",
              cause,
            );
          }
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
 * True when `packageName` is installed for `resolveFrom` (default
 * `process.cwd()`): in a `node_modules` directory there or in a parent, or in
 * one of Node's global directories (`NODE_PATH` first). A cheap, synchronous
 * capability probe — it does not load the driver.
 *
 * It checks the disk instead of asking Node's resolver: on Node 24 and later a
 * failed lookup is kept for the life of the process, so a resolver probe before
 * an install would hide the installed package from this process (#669). Under
 * Yarn Plug'n'Play, which has no `node_modules`, it asks the resolver.
 */
export function isDriverInstalled(packageName: string, options?: DriverLoadOptions): boolean {
  const fromDir = options?.resolveFrom ?? process.cwd();
  if (nodeModulesHolding(fromDir, packageName) !== undefined) return true;
  if (!process.versions.pnp) return false;
  try {
    createRequire(join(fromDir, "package.json")).resolve(packageName);
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
