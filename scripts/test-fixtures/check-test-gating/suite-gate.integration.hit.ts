import * as integration from "../../scripts/test-utils/integration.mjs";
integration.integrationSuite({}).skipIf(!process.env.DATABASE_URL)("through a namespace import", () => {}); // HIT
