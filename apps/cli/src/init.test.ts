import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  detectPackageManager,
  findNearestPackageJsonDir,
  isLikelyWorkspaceRoot,
  resolveInitDepSpecs,
} from "./init.js";

describe("init helpers", () => {
  it("findNearestPackageJsonDir finds parent package.json", () => {
    const root = mkdtempSync(join(tmpdir(), "askdb-init-test-"));
    try {
      writeFileSync(join(root, "package.json"), "{}\n", "utf8");
      const nested = join(root, "a", "b");
      mkdirSync(nested, { recursive: true });
      expect(findNearestPackageJsonDir(nested)).toBe(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("findNearestPackageJsonDir returns undefined when missing", () => {
    const root = mkdtempSync(join(tmpdir(), "askdb-init-test-"));
    try {
      expect(findNearestPackageJsonDir(join(root, "x"))).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("isLikelyWorkspaceRoot detects pnpm-workspace.yaml", () => {
    const root = mkdtempSync(join(tmpdir(), "askdb-init-test-"));
    try {
      writeFileSync(join(root, "package.json"), '{"name":"r"}\n', "utf8");
      writeFileSync(join(root, "pnpm-workspace.yaml"), "packages: []\n", "utf8");
      expect(isLikelyWorkspaceRoot(root)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("isLikelyWorkspaceRoot detects npm workspaces field", () => {
    const root = mkdtempSync(join(tmpdir(), "askdb-init-test-"));
    try {
      writeFileSync(join(root, "package.json"), '{"workspaces":["packages/*"]}\n', "utf8");
      expect(isLikelyWorkspaceRoot(root)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("isLikelyWorkspaceRoot is false for a leaf package.json", () => {
    const root = mkdtempSync(join(tmpdir(), "askdb-init-test-"));
    try {
      writeFileSync(join(root, "package.json"), '{"name":"app","private":true}\n', "utf8");
      expect(isLikelyWorkspaceRoot(root)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("detectPackageManager finds lockfile in a parent directory", () => {
    const root = mkdtempSync(join(tmpdir(), "askdb-init-test-"));
    try {
      writeFileSync(join(root, "package.json"), "{}\n", "utf8");
      writeFileSync(join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n", "utf8");
      const pkg = join(root, "packages", "app");
      mkdirSync(pkg, { recursive: true });
      writeFileSync(join(pkg, "package.json"), "{}\n", "utf8");
      expect(detectPackageManager(pkg)).toBe("pnpm");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("resolveInitDepSpecs returns non-empty specs", () => {
    const s = resolveInitDepSpecs();
    expect(s.configSpec.length).toBeGreaterThan(0);
    expect(s.dotenvSpec.length).toBeGreaterThan(0);
  });
});
