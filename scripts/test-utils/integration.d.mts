export interface IntegrationPrereqs {
  /**
   * Env vars the suite needs. A nested array means "any one of these" (e.g.
   * `[["ASKDB_PGVECTOR_URL", "PGVECTOR_URL"]]`).
   */
  env?: (string | string[])[];
  /** Non-empty when a driver/runtime prerequisite is missing; used as the failure reason. */
  unavailable?: string | false | null;
}

/** True when `ASKDB_REQUIRE_INTEGRATION` is `1`/`true`. */
export declare function isIntegrationRequired(): boolean;

/**
 * Returns `describe` when every prerequisite is met, `describe.skip` when one is missing,
 * or — under `ASKDB_REQUIRE_INTEGRATION=1` — a `describe` whose only test fails with the
 * missing prerequisite instead of skipping.
 */
export declare function integrationSuite(
  prereqs?: IntegrationPrereqs,
): (name: string, fn: () => void) => void;
