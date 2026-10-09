import { chmodSync, chownSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationSuite } from "../../../scripts/test-utils/integration.mjs";
import { otherGroup, otherGroupUnavailable, table, tableMd, writeSchema } from "./test-utils.js";
import { buildDefaultTableBody, loadWorkspace, modeWhenGroupLost, saveTable } from "./workspace.js";

// A save by a process that may not set the file's group, as when the saver
// doesn't belong to it.
vi.mock("node:fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs")>()),
  fchownSync: () => {
    throw Object.assign(new Error("EPERM: operation not permitted, fchown"), { code: "EPERM" });
  },
}));

describe("modeWhenGroupLost", () => {
  it.each([
    ["0660", "0600"],
    ["0664", "0644"],
    ["0604", "0600"],
    ["0640", "0600"],
    ["0644", "0644"],
    ["0750", "0700"],
    ["0777", "0777"],
  ])("gives the group and others only the access both had (%s → %s)", (mode, expected) => {
    expect(modeWhenGroupLost(parseInt(mode, 8))).toBe(parseInt(expected, 8));
  });
});

integrationSuite({ unavailable: otherGroupUnavailable })("saveTable when the file's group can't be kept", () => {
  let tmp: string;
  let schemaDir: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "askdb-enrich-own-"));
    schemaDir = join(tmp, "fname.schema");
    writeSchema(schemaDir, [table("public", "orders")]);
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("doesn't hand the group's access to the group the new file lands in", () => {
    const target = join(schemaDir, "tables", "orders.md");
    writeFileSync(target, tableMd("public", "orders", "Written before."), "utf8");
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
