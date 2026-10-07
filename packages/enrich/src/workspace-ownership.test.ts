import {
  chmodSync,
  chownSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationSuite } from "../../../scripts/test-utils/integration.mjs";
import { buildDefaultTableBody, loadWorkspace, saveTable, withoutGroupChange } from "./workspace.js";

// A save by a process that may not set the file's group, as when the saver
// doesn't belong to it.
vi.mock("node:fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs")>()),
  fchownSync: () => {
    throw Object.assign(new Error("EPERM: operation not permitted, fchown"), { code: "EPERM" });
  },
}));

describe("withoutGroupChange", () => {
  it.each([
    [0o660, 0o600],
    [0o664, 0o644],
    [0o604, 0o600],
    [0o640, 0o600],
    [0o644, 0o644],
    [0o750, 0o700],
    [0o777, 0o777],
  ])("gives the group and others only the access both had (%o → %o)", (mode, expected) => {
    expect(withoutGroupChange(mode)).toBe(expected);
  });
});

// A group, other than the one new files in a temp directory get, that this
// process belongs to and so may give a file.
const otherGroup = (() => {
  if (process.platform === "win32") return undefined;
  const dir = mkdtempSync(join(tmpdir(), "askdb-enrich-gid-"));
  const newFileGid = statSync(dir).gid;
  rmSync(dir, { recursive: true });
  return process.getgroups?.().find((g) => g !== newFileGid && g !== process.getegid?.());
})();

integrationSuite({
  unavailable:
    process.platform === "win32"
      ? "POSIX owners and groups are required (not Windows)"
      : otherGroup === undefined
        ? "this user belongs to no second group to give the file"
        : false,
})("saveTable when the file's group can't be kept", () => {
  let tmp: string;
  let schemaDir: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "askdb-enrich-own-"));
    schemaDir = join(tmp, "fname.schema");
    mkdirSync(join(schemaDir, "tables"), { recursive: true });
    const id = "table:public.orders";
    const columns = [
      { id: `${id}#id`, name: "id", type: "integer", nullable: false, primaryKey: true, sensitive: false },
    ];
    writeFileSync(
      join(schemaDir, "schema.json"),
      JSON.stringify({
        version: 2,
        schemaId: "fname",
        tables: [{ id, name: "orders", schema: "public", sensitive: false, columns }],
      }),
      "utf8",
    );
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("doesn't hand the group's access to the group the new file lands in", () => {
    const target = join(schemaDir, "tables", "orders.md");
    writeFileSync(target, "---\nid: table:public.orders\nname: orders\nschemaId: fname\n---\n", "utf8");
    chownSync(target, -1, otherGroup!);
    chmodSync(target, 0o660);
    const ws = loadWorkspace(schemaDir);

    saveTable(
      ws,
      "table:public.orders",
      { id: "table:public.orders", name: "orders", schemaId: "fname" },
      buildDefaultTableBody("orders", "Shared with one team."),
    );
    expect(readFileSync(target, "utf8")).toContain("Shared with one team.");
    expect(statSync(target).gid).not.toBe(otherGroup);
    expect(statSync(target).mode & 0o777).toBe(0o600);
  });
});
