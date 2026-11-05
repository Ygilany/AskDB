import { chmodSync, chownSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationSuite } from "../../../../../scripts/test-utils/integration.mjs";
import { modeWhenGroupLost, saveSchemaFile } from "./save-file.js";
import { otherGroup, otherGroupUnavailable } from "./test-utils.js";

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

integrationSuite({ unavailable: otherGroupUnavailable })("saveSchemaFile when the file's group can't be kept", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "askdb-core-own-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("doesn't hand the group's access to the group the new file lands in", () => {
    const target = join(tmp, "concepts.md");
    writeFileSync(target, "Written before.\n", "utf8");
    chownSync(target, -1, otherGroup!);
    chmodSync(target, 0o660);

    saveSchemaFile(tmp, "concepts.md", "Shared with one team.\n");
    expect(readFileSync(target, "utf8")).toBe("Shared with one team.\n");
    expect(statSync(target).gid).not.toBe(otherGroup);
    expect(statSync(target).mode & 0o777).toBe(0o600);
  });
});
