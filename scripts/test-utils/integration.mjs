// Shared gate for live-database integration suites.
//
// Integration suites skip when their prerequisites (a DATABASE_URL-style env var, an
// optional native driver) are missing, so a plain `pnpm test` stays green on a laptop.
// CI sets ASKDB_REQUIRE_INTEGRATION=1: a missing prerequisite then FAILS the suite
// instead of silently skipping it, so a broken env passthrough or a missing service
// can't turn the integration run into a no-op.
//
// Plain ESM + a sibling `.d.mts` (not `.ts`) so packages can import it by relative path
// without pulling a file outside their `rootDir: "src"` into their TypeScript program.
import { describe, it } from "vitest";

/** True when the environment forbids skipping integration suites. */
export function isIntegrationRequired() {
  const v = process.env.ASKDB_REQUIRE_INTEGRATION?.trim().toLowerCase();
  return v === "1" || v === "true";
}

/**
 * @param {{ env?: (string | string[])[]; unavailable?: string | false | null }} [prereqs]
 */
export function integrationSuite(prereqs = {}) {
  const { env = [], unavailable } = prereqs;
  const reasons = [];
  for (const entry of env) {
    const names = Array.isArray(entry) ? entry : [entry];
    if (!names.some((name) => process.env[name]?.trim())) {
      reasons.push(`env ${names.join(" or ")} is not set`);
    }
  }
  if (unavailable) reasons.push(unavailable);

  if (reasons.length === 0) return describe;
  if (!isIntegrationRequired()) return describe.skip;

  const message =
    `ASKDB_REQUIRE_INTEGRATION=1 forbids skipping this integration suite, but ` +
    `${reasons.join("; ")}. Start the fixture databases and export the URLs ` +
    `(see CONTRIBUTING.md "Integration tests"), or unset ASKDB_REQUIRE_INTEGRATION.`;

  /** @param {string} name */
  return (name) =>
    describe(name, () => {
      it("has its integration prerequisites", () => {
        throw new Error(message);
      });
    });
}
