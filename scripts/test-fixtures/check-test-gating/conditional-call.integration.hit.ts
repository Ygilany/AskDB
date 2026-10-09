import { integrationSuite } from "../test-utils/integration.mjs";
const run = integrationSuite({ env: ["DATABASE_URL"] });
if (process.env.EXTRA) run("a sanctioned suite defined under a condition", () => {}); // HIT
