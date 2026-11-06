import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { resolveInitDepSpecs, runInitCli } from "./init.js";

// The package manager is a separate process: stand in for it at the spawn.
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawnSync: vi.fn(actual.spawnSync) };
});

const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
const prevCwd = process.cwd();
let project: string | undefined;

afterEach(() => {
  Object.defineProperty(process, "platform", platform);
  process.chdir(prevCwd);
  vi.restoreAllMocks();
  if (project) rmSync(project, { recursive: true, force: true });
  project = undefined;
});

// #668: package managers are `.cmd` shims on Windows, and Node refuses to spawn one
// without a shell (EINVAL since the CVE-2024-27980 fix).
it("runs the install on Windows through a shell, with the bare command name", async () => {
  project = realpathSync(mkdtempSync(join(tmpdir(), "askdb-init-win32-")));
  writeFileSync(join(project, "package.json"), '{ "name": "app", "private": true }\n', "utf8");
  writeFileSync(join(project, "package-lock.json"), "{}\n", "utf8");
  process.chdir(project);
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.mocked(spawnSync).mockReturnValue({ status: 0 } as ReturnType<typeof spawnSync>);
  Object.defineProperty(process, "platform", { ...platform, value: "win32" });

  const code = await runInitCli(["--yes", "--database", "sqlite", "--sqlite-file", "./shop.db", "--path", join(project, "askdb.config.ts")]);

  expect(code).toBe(0);
  expect(spawnSync).toHaveBeenCalledWith(
    "npm",
    ["install", "--save", `@askdb/config@${resolveInitDepSpecs().configSpec}`, "better-sqlite3"],
    expect.objectContaining({ cwd: project, shell: true }),
  );
});
