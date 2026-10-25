import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
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
  const dir = await mkdtemp(join(tmpdir(), "askdb-kit-driver-"));
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

  it("reports a non-resolution load error as itself, without the install hint or the project fallback", async () => {
    const boom = new Error("driver exploded while loading");
    const loader = createOptionalDriverLoader({
      packageName: PKG,
      importDriver: async () => {
        throw boom;
      },
      missingMessage: "missing",
    });
    const err = await loader.load().catch((e: unknown) => e);
    expect((err as Error).name).toBe("AskDbError");
    expect((err as Error).message).toBe(
      `The optional \`${PKG}\` peer dependency failed to load: driver exploded while loading`,
    );
    expect((err as { cause?: unknown }).cause).toBe(boom);
  });

  it("reports an installed driver whose own dependency is missing, not the install hint", async () => {
    const project = await tempProject(true);
    // The installed driver requires a module that isn't installed.
    await writeFile(
      join(project, "node_modules", PKG, "index.cjs"),
      "require('askdb-kit-missing-dependency');\n",
    );
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
    expect((err as Error).message).toContain("askdb-kit-missing-dependency");
  });

  // An installed driver that fails to load one of its own files is broken, not
  // missing: that error surfaces instead of the install hint, whether the
  // driver came from the engine's import or from the project fallback.
  it("reports an installed driver missing its own file, found through the project fallback", async () => {
    const project = await tempProject(true);
    await writeFile(join(project, "node_modules", PKG, "index.cjs"), `require('${PKG}/lib/missing');\n`);
    const loader = createOptionalDriverLoader({
      packageName: PKG,
      importDriver: async () => {
        throw notFound();
      },
      missingMessage: "install it",
    });

    const err = await loader.load({ resolveFrom: project }).catch((e: unknown) => e);
    expect((err as Error).message).not.toContain("install it");
    expect((err as Error).message).toContain(`The optional \`${PKG}\` peer dependency failed to load:`);
    expect((err as Error).message).toContain(`${PKG}/lib/missing`);
  });

  // Pins the fallback's resolve/import split: the driver resolves, and its own
  // load throws a not-found error that names the driver itself.
  it("reports a resolved driver whose load throws 'Cannot find module <driver>', not the install hint", async () => {
    const project = await tempProject(true);
    await writeFile(
      join(project, "node_modules", PKG, "index.cjs"),
      `throw Object.assign(new Error("Cannot find module '${PKG}'"), { code: "MODULE_NOT_FOUND" });\n`,
    );
    const loader = createOptionalDriverLoader({
      packageName: PKG,
      importDriver: async () => {
        throw notFound();
      },
      missingMessage: "install it",
    });

    const err = await loader.load({ resolveFrom: project }).catch((e: unknown) => e);
    expect((err as Error).message).not.toContain("install it");
    expect((err as Error).message).toContain(`The optional \`${PKG}\` peer dependency failed to load:`);
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
  it("reports whether the package resolves from resolveFrom", async () => {
    expect(isDriverInstalled(PKG, { resolveFrom: await tempProject(true) })).toBe(true);
    expect(isDriverInstalled(PKG, { resolveFrom: await tempProject(false) })).toBe(false);
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
