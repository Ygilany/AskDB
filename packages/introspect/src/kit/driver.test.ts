import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createOptionalDriverLoader,
  isDriverInstalled,
  isModuleResolutionFailure,
  missingDriverMessage,
} from "./driver.js";

const PKG = "askdb-kit-fake-driver";

function notFound(pkg = PKG): Error {
  const err = new Error(`Cannot find package '${pkg}' imported from somewhere`);
  (err as { code?: string }).code = "ERR_MODULE_NOT_FOUND";
  return err;
}

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
  await Promise.all(tempDirs.map((dir) => rm(dir, { force: true, recursive: true })));
  tempDirs = [];
});

describe("isModuleResolutionFailure", () => {
  it("matches resolution codes that name the package, including nested causes", () => {
    expect(isModuleResolutionFailure(notFound(), PKG)).toBe(true);
    expect(isModuleResolutionFailure(notFound("other"), PKG)).toBe(false);
    expect(isModuleResolutionFailure(new Error(`boom ${PKG}`), PKG)).toBe(false);
    expect(isModuleResolutionFailure(new Error("wrapper", { cause: notFound() }), PKG)).toBe(true);
    expect(isModuleResolutionFailure("not an error", PKG)).toBe(false);
  });
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

  it("wraps non-resolution load errors without trying the project fallback", async () => {
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
    expect((err as { cause?: unknown }).cause).toBe(boom);
  });
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
