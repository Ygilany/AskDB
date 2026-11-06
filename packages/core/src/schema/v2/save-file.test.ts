import {
  chmodSync,
  chownSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { integrationSuite } from "../../../../../scripts/test-utils/integration.mjs";
import { saveSchemaFile } from "../../index.js";
import { otherGroup, otherGroupUnavailable, posixModesUnavailable } from "./test-utils.js";

let tmp: string;
let schemaDir: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "askdb-save-file-"));
  schemaDir = join(tmp, "orders.schema");
  mkdirSync(join(schemaDir, "tables"), { recursive: true });
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("saveSchemaFile", () => {
  // A checkout can carry a symbolic link at any file (git stores them).
  it("refuses to write through a symbolic link at the file", () => {
    const outside = join(tmp, "outside.json");
    writeFileSync(outside, "untouched\n", "utf8");
    symlinkSync(outside, join(schemaDir, "schema.json"));

    expect(() => saveSchemaFile(schemaDir, "schema.json", "{}\n")).toThrow(
      'Refusing to write schema.json outside the schema directory: "schema.json" is a symbolic link',
    );
    expect(readFileSync(outside, "utf8")).toBe("untouched\n");
  });

  it("refuses to write when a directory below the schema directory is a symbolic link", () => {
    rmSync(join(schemaDir, "tables"), { recursive: true });
    const elsewhere = join(tmp, "elsewhere");
    mkdirSync(elsewhere);
    symlinkSync(elsewhere, join(schemaDir, "tables"));

    expect(() => saveSchemaFile(schemaDir, "tables/orders.md", "# Table: orders\n")).toThrow(
      "Refusing to write tables/orders.md outside the schema directory: tables/ is a symbolic link",
    );
    expect(readdirSync(elsewhere)).toEqual([]);
  });

  it("writes through a schema directory that is itself a symbolic link", () => {
    const link = join(tmp, "linked.schema");
    symlinkSync(schemaDir, link);

    saveSchemaFile(link, "tables/orders.md", "# Table: orders\n");
    expect(readFileSync(join(schemaDir, "tables", "orders.md"), "utf8")).toBe("# Table: orders\n");
  });

  it.each(["../escape.json", "/escape.json", "tables/../../escape.json", "./schema.json", "tables//orders.md", "a\0b"])(
    "refuses a path with an empty, `.` or `..` part, or a NUL byte (%j)",
    (relativePath) => {
      expect(() => saveSchemaFile(schemaDir, relativePath, "{}\n")).toThrow(
        /outside the schema directory: ".*" is not a file or directory name$/,
      );
      expect(readdirSync(tmp)).toEqual(["orders.schema"]);
      expect(readdirSync(schemaDir)).toEqual(["tables"]);
    },
  );

  it("replaces a hard-linked file instead of writing through the link", () => {
    const outside = join(tmp, "outside.md");
    writeFileSync(outside, "untouched\n", "utf8");
    const target = join(schemaDir, "tables", "orders.md");
    linkSync(outside, target);

    saveSchemaFile(schemaDir, "tables/orders.md", "# Table: orders\n");
    expect(readFileSync(outside, "utf8")).toBe("untouched\n");
    expect(readFileSync(target, "utf8")).toBe("# Table: orders\n");
    expect(statSync(target).nlink).toBe(1);
    expect(readdirSync(join(schemaDir, "tables"))).toEqual(["orders.md"]);
  });

  it("reports a failed replace and leaves no temp file behind", () => {
    // A non-empty directory at the target passes the link and permission checks,
    // then makes the rename fail after the temp file has been written.
    const target = join(schemaDir, "tables", "orders.md");
    mkdirSync(target);
    writeFileSync(join(target, "keep"), "kept\n", "utf8");

    expect(() => saveSchemaFile(schemaDir, "tables/orders.md", "# Table: orders\n")).toThrow(/rename/);
    expect(readdirSync(join(schemaDir, "tables"))).toEqual(["orders.md"]);
    expect(readFileSync(join(target, "keep"), "utf8")).toBe("kept\n");
  });
});

// File modes only mean this on POSIX, and root passes every write-permission check.
integrationSuite({
  unavailable:
    posixModesUnavailable ||
    (process.getuid?.() === 0 ? "running as root, where every file is writable" : false),
})("saveSchemaFile on a read-only file", () => {
  it("refuses with EACCES and leaves the file unchanged", () => {
    const target = join(schemaDir, "tables", "orders.md");
    writeFileSync(target, "Checked out read-only.\n", "utf8");
    chmodSync(target, 0o444);

    expect(() => saveSchemaFile(schemaDir, "tables/orders.md", "# Table: orders\n")).toThrow(/EACCES/);
    expect(readFileSync(target, "utf8")).toBe("Checked out read-only.\n");
    expect(statSync(target).mode & 0o777).toBe(0o444);
    expect(readdirSync(join(schemaDir, "tables"))).toEqual(["orders.md"]);
  });
});

integrationSuite({ unavailable: posixModesUnavailable })("saveSchemaFile and file permission bits", () => {
  it("keeps the replaced file's mode", () => {
    const target = join(schemaDir, "tables", "orders.md");
    writeFileSync(target, "Private notes.\n", "utf8");
    chmodSync(target, 0o600);

    saveSchemaFile(schemaDir, "tables/orders.md", "# Table: orders\n");
    expect(readFileSync(target, "utf8")).toBe("# Table: orders\n");
    expect(statSync(target).mode & 0o777).toBe(0o600);
  });
});

integrationSuite({ unavailable: otherGroupUnavailable })("saveSchemaFile and file ownership", () => {
  it("keeps the replaced file's group", () => {
    const target = join(schemaDir, "tables", "orders.md");
    writeFileSync(target, "Shared with one team.\n", "utf8");
    chownSync(target, -1, otherGroup!);
    chmodSync(target, 0o660);

    saveSchemaFile(schemaDir, "tables/orders.md", "# Table: orders\n");
    expect(readFileSync(target, "utf8")).toBe("# Table: orders\n");
    expect(statSync(target).gid).toBe(otherGroup);
    expect(statSync(target).mode & 0o777).toBe(0o660);
  });
});
