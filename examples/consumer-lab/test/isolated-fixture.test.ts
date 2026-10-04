/**
 * Protects: #323's fail-closed boundary before any server-wide statement can run.
 * Catches: a flag-only guard, accepting the shared ports, or trusting a remote host.
 * Not covered elsewhere: rejection tests exercise AskDB, not the lab's execution boundary.
 * No production seam: the same lab guard is used by the runner and effect proofs.
 */
import { connectionUrl } from "../src/fixture.js";
import { describe, expect, it, vi } from "vitest";
import { assertIsolatedTarget, docker, ISOLATED_PROJECT } from "../src/isolated-fixture.js";

const targets = [
  ["postgres", "postgres://fixture_owner:fixture_owner@127.0.0.1:15432/postgres"],
  ["mysql", "mysql://root:fixture_owner@127.0.0.1:13306/"],
  ["mariadb", "mysql://root:fixture_owner@127.0.0.1:13307/"],
  ["sqlserver", "Server=127.0.0.1,11433;User Id=sa;Password=unused"],
  ["postgres", "postgres://fixture_owner:fixture_owner@remote.invalid:25432/postgres"],
  ["mysql", "mysql://root:fixture_owner@remote.invalid:23306/"],
  ["sqlserver", "Server=remote.invalid,21433;User Id=sa;Password=unused"],
] as const;

describe("isolated fixture guard", () => {
  it.each(targets)("refuses unsafe %s endpoint %s", (dialect, url) => {
    expect(() => assertIsolatedTarget(dialect, url)).toThrow(/isolated fixture: refused endpoint/);
  });
});

/**
 * Protects: the driver cannot override the endpoint the isolation guard approves.
 * Catches: PostgreSQL URL query parameters redirecting an apparently isolated URL.
 * Not covered elsewhere: plain shared-port refusals do not exercise driver URL overrides.
 * No production seam: the real fixture URL builder and the suite's execution guard.
 */
it("refuses a fixture host that injects driver endpoint overrides", () => {
  vi.stubEnv("ASKDB_FIXTURE_HOST", "127.0.0.1:25432/postgres?host=127.0.0.1&port=15432&unused=");
  vi.stubEnv("ASKDB_FIXTURE_POSTGRES_PORT", "25432");
  try {
    expect(() => assertIsolatedTarget("postgres", connectionUrl("postgres", "owner")))
      .toThrow(/isolated fixture: refused noncanonical URL/);
  } finally {
    vi.unstubAllEnvs();
  }
});

// Only the lifecycle runner owns containers it is allowed to alter. It runs this
// file before safety.test.ts, so these negative controls cannot race the proofs.
if (process.env.ASKDB_LAB_ISOLATED === "1") {
  /**
   * Protects: a correct host and port must also belong to the expected live container.
   * Catches: replacing container identity checks with an opt-in flag or port-only check.
   * Not covered elsewhere: unsafe URL tests stop before resolving a live binding.
   * No production seam: real Docker identity and the guard used by the suite.
   */
  it("refuses an unexpected container serving the correct isolated port", () => {
    const url = connectionUrl("postgres", "owner");
    expect(assertIsolatedTarget("postgres", url)).toBeTruthy();
    const name = `${ISOLATED_PROJECT}-relay-1`;
    const impostor = `${ISOLATED_PROJECT}-unexpected-relay`;
    docker(["rename", name, impostor]);
    try {
      expect(() => assertIsolatedTarget("postgres", url)).toThrow(/relay identity/);
    } finally {
      docker(["rename", impostor, name]);
    }
  });

  /**
   * Protects: a correctly addressed database cannot have an additional external route.
   * Catches: inspecting project labels alone while permitting another network attachment.
   * Not covered elsewhere: SQL rejection and port tests cannot observe container routing.
   * No production seam: Docker network state and the execution guard.
   */
  it("refuses an isolated database attached to an external network", () => {
    const url = connectionUrl("postgres", "owner");
    const container = assertIsolatedTarget("postgres", url);
    const network = `${ISOLATED_PROJECT}_entry`;
    docker(["network", "connect", network, container]);
    try {
      expect(() => assertIsolatedTarget("postgres", url)).toThrow(/network\/mount isolation/);
    } finally {
      docker(["network", "disconnect", network, container]);
    }
  });
}
