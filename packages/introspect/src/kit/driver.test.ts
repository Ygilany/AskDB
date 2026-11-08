import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import Module, { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createOptionalDriverLoader,
  isDriverInstalled,
  missingDriverMessage,
} from "./driver.js";

const PKG = "askdb-kit-fake-driver";

function notFound(pkg = PKG): Error {
  const err = new Error(`Cannot find package '${pkg}' imported from somewhere`);
  (err as { code?: string }).code = "ERR_MODULE_NOT_FOUND";
  return err;
}

function cjsNotFound(specifier: string): Error {
  return Object.assign(new Error(`Cannot find module '${specifier}'\nRequire stack:\n- /app/index.js`), {
    code: "MODULE_NOT_FOUND",
  });
}

function pnpUndeclared(name: string): Error {
  return Object.assign(
    new Error(
      `Your application tried to access ${name}, but it isn't declared in your dependencies; ` +
        "this makes the require call ambiguous and unsound.\n\nRequired package: " + name,
    ),
    { code: "MODULE_NOT_FOUND" },
  );
}

const originalCwd = process.cwd();
let tempDirs: string[] = [];

async function tempProject(withDriver: boolean): Promise<string> {
  // realpath: macOS tmpdir is a symlink, and Node reports resolved paths through it.
  const dir = await realpath(await mkdtemp(join(tmpdir(), "askdb-kit-driver-")));
  tempDirs.push(dir);
  await writeFile(join(dir, "package.json"), '{"type":"module"}\n');
  if (withDriver) {
    const pkgDir = join(dir, "node_modules", PKG);
    await mkdir(pkgDir, { recursive: true });
    await writeFile(join(pkgDir, "package.json"), '{"main":"index.cjs"}\n');
    await writeFile(join(pkgDir, "index.cjs"), "module.exports = { from: 'project' };\n");
  }
  return dir;
}

afterEach(async () => {
  process.chdir(originalCwd);
  await Promise.all(tempDirs.map((dir) => rm(dir, { force: true, recursive: true })));
  tempDirs = [];
});

describe("createOptionalDriverLoader", () => {
  it("loads through the engine import and caches the result", async () => {
    const importDriver = vi.fn(async () => ({ from: "engine" }));
    const loader = createOptionalDriverLoader({ packageName: PKG, importDriver, missingMessage: "missing" });

    await expect(loader.load()).resolves.toEqual({ from: "engine" });
    await expect(loader.load()).resolves.toEqual({ from: "engine" });
    expect(importDriver).toHaveBeenCalledTimes(1);
  });

  it("falls back to resolveFrom when the engine import cannot see the peer", async () => {
    const project = await tempProject(true);
    const loader = createOptionalDriverLoader<{ from?: string; default?: { from: string } }>({
      packageName: PKG,
      importDriver: async () => {
        throw notFound();
      },
      missingMessage: "missing",
    });

    const mod = await loader.load({ resolveFrom: project });
    expect(mod.default?.from ?? mod.from).toBe("project");
  });

  it("defaults resolveFrom to process.cwd()", async () => {
    const project = await tempProject(true);
    process.chdir(project);
    const loader = createOptionalDriverLoader<{ from?: string; default?: { from: string } }>({
      packageName: PKG,
      importDriver: async () => {
        throw notFound();
      },
      missingMessage: "missing",
    });

    const mod = await loader.load();
    expect(mod.default?.from ?? mod.from).toBe("project");
  });

  it("rejects with an AskDbError carrying missingMessage, then retries after a failure", async () => {
    const empty = await tempProject(false);
    let installed = false;
    const importDriver = vi.fn(async () => {
      if (!installed) throw notFound();
      return { from: "engine" };
    });
    const loader = createOptionalDriverLoader({ packageName: PKG, importDriver, missingMessage: "install it" });

    const err = await loader.load({ resolveFrom: empty }).catch((e: unknown) => e);
    expect((err as Error).name).toBe("AskDbError");
    expect((err as Error).message).toBe("install it");
    expect((err as { cause?: unknown }).cause).toBeInstanceOf(AggregateError);

    installed = true;
    await expect(loader.load({ resolveFrom: empty })).resolves.toEqual({ from: "engine" });
    expect(importDriver).toHaveBeenCalledTimes(2);
  });

  // Node 24 and later keep a failed package lookup for the life of the process (#669): a
  // package written after a miss doesn't resolve again in that process. The loader then loads
  // it from disk, so a driver Studio installs works without a restart.
  it("loads a driver installed after a failed load, in the same process", async () => {
    const dir = await tempProject(false);
    await mkdir(join(dir, "node_modules"));
    const loader = createOptionalDriverLoader<{ default: { from: string } }>({
      packageName: PKG,
      importDriver: async () => {
        throw notFound();
      },
      missingMessage: "install it",
    });
    await expect(loader.load({ resolveFrom: dir })).rejects.toThrow("install it");

    const pkgDir = join(dir, "node_modules", PKG);
    await mkdir(join(pkgDir, "dist"), { recursive: true });
    await writeFile(join(pkgDir, "package.json"), '{"exports":{".":"./dist/index.cjs"}}\n');
    await writeFile(join(pkgDir, "dist", "index.cjs"), "module.exports = { from: 'project' };\n");
    await expect(loader.load({ resolveFrom: dir })).resolves.toMatchObject({ default: { from: "project" } });
  });

  it("loads from disk through nested conditional exports, as pg declares them", async () => {
    const dir = await tempProject(false);
    await mkdir(join(dir, "node_modules"));
    // Miss first, so this process can't resolve the package by name afterwards on Node 24+.
    expect(() => createRequire(join(dir, "package.json")).resolve(PKG)).toThrow();
    const pkgDir = join(dir, "node_modules", PKG);
    await mkdir(join(pkgDir, "lib"), { recursive: true });
    await writeFile(
      join(pkgDir, "package.json"),
      JSON.stringify({
        exports: {
          ".": { import: { types: "./x.d.ts", default: "./esm/index.mjs" }, require: { types: "./x.d.ts", default: "./lib/index.js" } },
        },
      }),
    );
    await writeFile(join(pkgDir, "lib", "index.js"), "module.exports = { from: 'require-entry' };\n");
    const loader = createOptionalDriverLoader<{ default: { from: string } }>({
      packageName: PKG,
      importDriver: async () => {
        throw notFound();
      },
      missingMessage: "install it",
    });
    await expect(loader.load({ resolveFrom: dir })).resolves.toMatchObject({ default: { from: "require-entry" } });
  });

  it("loads from disk through a module-sync condition, which Node's require reads", async () => {
    const dir = await tempProject(false);
    await mkdir(join(dir, "node_modules"));
    expect(() => createRequire(join(dir, "package.json")).resolve(PKG)).toThrow();
    const pkgDir = join(dir, "node_modules", PKG);
    await mkdir(pkgDir, { recursive: true });
    await writeFile(join(pkgDir, "package.json"), JSON.stringify({ exports: { ".": { "module-sync": "./i.mjs", import: "./i.mjs" } } }));
    await writeFile(join(pkgDir, "i.mjs"), "export const from = 'module-sync';\n");
    const loader = createOptionalDriverLoader<{ from: string }>({
      packageName: PKG,
      importDriver: async () => {
        throw notFound();
      },
      missingMessage: "install it",
    });
    await expect(loader.load({ resolveFrom: dir })).resolves.toMatchObject({ from: "module-sync" });
  });

  it("loads a subpath specifier from disk when the package has no exports map, as mysql2/promise", async () => {
    const dir = await tempProject(false);
    await mkdir(join(dir, "node_modules"));
    expect(() => createRequire(join(dir, "package.json")).resolve(`${PKG}/promise`)).toThrow();
    const pkgDir = join(dir, "node_modules", PKG);
    await mkdir(pkgDir, { recursive: true });
    await writeFile(join(pkgDir, "package.json"), '{"main":"index.js"}\n');
    await writeFile(join(pkgDir, "promise.js"), "module.exports = { from: 'promise' };\n");
    const loader = createOptionalDriverLoader<{ default: { from: string } }>({
      packageName: PKG,
      specifier: `${PKG}/promise`,
      importDriver: async () => {
        throw notFound(`${PKG}/promise`);
      },
      missingMessage: "install it",
    });
    await expect(loader.load({ resolveFrom: dir })).resolves.toMatchObject({ default: { from: "promise" } });
  });

  it("says to restart when the package is on disk but its entry can't be read from its package.json", async () => {
    const dir = await tempProject(false);
    await mkdir(join(dir, "node_modules"));
    expect(() => createRequire(join(dir, "package.json")).resolve(PKG)).toThrow();
    const pkgDir = join(dir, "node_modules", PKG);
    await mkdir(pkgDir, { recursive: true });
    // A main that names a missing file: nothing to load from disk, on any Node version.
    await writeFile(join(pkgDir, "package.json"), '{"main":"missing.js"}\n');
    const loader = createOptionalDriverLoader<unknown>({
      packageName: PKG,
      importDriver: async () => {
        throw notFound();
      },
      missingMessage: "install it",
    });
    const err = (await loader.load({ resolveFrom: dir }).catch((e: Error) => e)) as Error;
    expect(err.name).toBe("AskDbError");
    // Node 22 keeps no miss: it resolves the package again and reports its missing main file.
    if (Number(process.versions.node.split(".")[0]) < 24) {
      expect(err.message).toMatch(/failed to load: Cannot find module '.*missing\.js'/);
      return;
    }
    expect(err.message).toBe(
      `\`${PKG}\` is in ${join(dir, "node_modules")}, but Node can't load it in this process. ` +
        "If it was installed while the process was running, restart the process: " +
        "Node 24 and later can keep a failed package lookup until the process exits.",
    );
  });

  it("keeps independent cache slots per resolveFrom", async () => {
    const withDriver = await tempProject(true);
    const without = await tempProject(false);
    const loader = createOptionalDriverLoader({
      packageName: PKG,
      importDriver: async () => {
        throw notFound();
      },
      missingMessage: "missing",
    });

    await expect(loader.load({ resolveFrom: withDriver })).resolves.toBeDefined();
    await expect(loader.load({ resolveFrom: without })).rejects.toThrow("missing");
  });

  // An installed driver that fails to load is broken, not missing: that error
  // surfaces instead of the install hint, whether the driver came from the
  // engine's import or from the project fallback. The third row pins the
  // fallback's resolve/import split: the driver resolves, and its own load
  // throws a not-found error that names the driver itself.
  it.each([
    {
      name: "own dependency missing",
      body: "require('askdb-kit-missing-dependency');\n",
      detail: "askdb-kit-missing-dependency",
    },
    {
      name: "own file missing, found through the project fallback",
      body: `require('${PKG}/lib/missing');\n`,
      detail: `${PKG}/lib/missing`,
    },
    {
      name: "load throws 'Cannot find module <driver>'",
      body: `throw Object.assign(new Error("Cannot find module '${PKG}'"), { code: "MODULE_NOT_FOUND" });\n`,
      detail: `Cannot find module '${PKG}'`,
    },
  ])("reports a resolved driver that fails to load, not the install hint: $name", async ({ body, detail }) => {
    const project = await tempProject(true);
    await writeFile(join(project, "node_modules", PKG, "index.cjs"), body);
    const loader = createOptionalDriverLoader({
      packageName: PKG,
      importDriver: async () => {
        throw notFound();
      },
      missingMessage: "install it",
    });

    const err = await loader.load({ resolveFrom: project }).catch((e: unknown) => e);
    expect((err as Error).name).toBe("AskDbError");
    expect((err as Error).message).not.toContain("install it");
    expect((err as Error).message).toContain(`The optional \`${PKG}\` peer dependency failed to load:`);
    expect((err as Error).message).toContain(detail);
  });

  it("reports an installed driver missing its own file, found through the engine's import", async () => {
    const ownFile = Object.assign(new Error(`Cannot find module '${PKG}/lib/missing'`), { code: "MODULE_NOT_FOUND" });
    const loader = createOptionalDriverLoader({
      packageName: PKG,
      importDriver: async () => {
        throw ownFile;
      },
      missingMessage: "install it",
    });

    const err = await loader.load({ resolveFrom: await tempProject(false) }).catch((e: unknown) => e);
    expect((err as Error).message).toBe(
      `The optional \`${PKG}\` peer dependency failed to load: Cannot find module '${PKG}/lib/missing'`,
    );
    expect((err as { cause?: unknown }).cause).toBe(ownFile);
  });
  // Error classification: only a resolution failure naming exactly the package (or the
  // entry point the loader asks for) means "not installed"; anything else is a broken
  // install and surfaces as itself. Fake names keep a real `node_modules` from satisfying
  // the project fallback.
  const NOT_FOUND = "install it";
  const failedToLoad = (detail: string) => `The optional \`${PKG}\` peer dependency failed to load: ${detail}`;
  it.each([
    { name: "own not-found", thrown: notFound(), match: true },
    { name: "nested cause", thrown: new Error("wrapper", { cause: notFound() }), match: true },
    {
      name: "subpath entry point",
      thrown: cjsNotFound(`${PKG}/promise`),
      specifier: `${PKG}/promise`,
      match: true,
    },
    { name: "Yarn PnP, exact", thrown: pnpUndeclared(PKG), match: true },
    { name: "other package", thrown: notFound("askdb-kit-other-driver"), match: false },
    { name: "name-prefix package", thrown: notFound(`${PKG}-connection-string`), match: false },
    {
      name: "path containing the name",
      thrown: cjsNotFound(`/home/${PKG}user/app/db.js`),
      match: false,
    },
    { name: "Yarn PnP, near-miss", thrown: pnpUndeclared(`${PKG}-connection-string`), match: false },
    { name: "generic error naming the package", thrown: new Error(`boom ${PKG}`), match: false },
    { name: "non-Error throw", thrown: "not an error", match: false },
  ] as Array<{ name: string; thrown: unknown; specifier?: string; match: boolean }>)(
    "classifies an import failure: $name",
    async ({ thrown, specifier, match }) => {
      const loader = createOptionalDriverLoader({
        packageName: PKG,
        specifier,
        importDriver: async () => {
          throw thrown;
        },
        missingMessage: NOT_FOUND,
      });

      const err = await loader.load({ resolveFrom: await tempProject(false) }).catch((e: unknown) => e);

      expect((err as Error).name).toBe("AskDbError");
      if (match) {
        expect((err as Error).message).toBe(NOT_FOUND);
      } else {
        expect((err as Error).message).toBe(failedToLoad(thrown instanceof Error ? thrown.message : String(thrown)));
        expect((err as { cause?: unknown }).cause).toBe(thrown);
      }
    },
  );
});

describe("isDriverInstalled", () => {
  it("reports whether the package is in node_modules under resolveFrom or a parent", async () => {
    const project = await tempProject(true);
    expect(isDriverInstalled(PKG, { resolveFrom: project })).toBe(true);
    const nested = join(project, "apps", "web");
    await mkdir(nested, { recursive: true });
    expect(isDriverInstalled(PKG, { resolveFrom: nested })).toBe(true);
    expect(isDriverInstalled(PKG, { resolveFrom: await tempProject(false) })).toBe(false);
  });

  // #669: the probe must not ask Node's resolver, which on Node 24+ keeps the miss and then
  // can't see the driver Studio installs next, in the probe or in the load.
  it("sees a package installed after a negative probe, and leaves nothing for Node to keep", async () => {
    const dir = await tempProject(false);
    await mkdir(join(dir, "node_modules"));
    expect(isDriverInstalled(PKG, { resolveFrom: dir })).toBe(false);
    const pkgDir = join(dir, "node_modules", PKG);
    await mkdir(pkgDir, { recursive: true });
    await writeFile(join(pkgDir, "package.json"), '{"main":"index.cjs"}\n');
    await writeFile(join(pkgDir, "index.cjs"), "module.exports = {};\n");
    expect(isDriverInstalled(PKG, { resolveFrom: dir })).toBe(true);
    expect(createRequire(join(dir, "package.json")).resolve(PKG)).toBe(join(pkgDir, "index.cjs"));
  });

  it("finds a package in Node's global directories, where NODE_PATH goes", async () => {
    const global = await tempProject(true);
    const project = await tempProject(false);
    // Node copies NODE_PATH into Module.globalPaths at startup.
    const globalPaths = (Module as unknown as { globalPaths: string[] }).globalPaths;
    globalPaths.unshift(join(global, "node_modules"));
    try {
      expect(isDriverInstalled(PKG, { resolveFrom: project })).toBe(true);
    } finally {
      globalPaths.shift();
    }
  });

  it("asks the resolver under Yarn Plug'n'Play, which has no node_modules", async () => {
    // Resolvable by Node, but not under node_modules: only the resolver can find it.
    const dir = await tempProject(false);
    await mkdir(join(dir, "vendor", PKG), { recursive: true });
    await writeFile(join(dir, "vendor", PKG, "package.json"), '{"main":"index.cjs"}\n');
    await writeFile(join(dir, "vendor", PKG, "index.cjs"), "module.exports = {};\n");
    await writeFile(join(dir, "package.json"), `{"type":"module","imports":{"#x":"./vendor/${PKG}/index.cjs"}}\n`);
    expect(isDriverInstalled("#x", { resolveFrom: dir })).toBe(false);
    const versions = process.versions as { pnp?: string };
    versions.pnp = "3";
    try {
      expect(isDriverInstalled("#x", { resolveFrom: dir })).toBe(true);
    } finally {
      delete versions.pnp;
    }
  });
});

describe("missingDriverMessage", () => {
  it("renders the first-party install hint", () => {
    expect(missingDriverMessage({ engine: "Postgres", packageName: "pg" })).toBe(
      "The built-in Postgres catalog query runner requires the optional `pg` peer dependency. " +
        "Install it in your project (e.g. `pnpm add pg`) or include it in the same one-off command " +
        "(e.g. `pnpm dlx -p askdb -p pg askdb ...` or `npx -p askdb -p pg askdb ...`). " +
        "You can also pass a custom catalog query runner to the Postgres connector.",
    );
  });
});
