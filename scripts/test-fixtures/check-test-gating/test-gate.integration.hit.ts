import { integrationSuite } from "../../../scripts/test-utils/integration.mjs";
integrationSuite({ env: ["DATABASE_URL"] })("a sanctioned suite's test API", (test) => {
  test.skipIf(!process.env.ASKDB_PGVECTOR_URL)("needs pgvector too", () => {}); // HIT
});
