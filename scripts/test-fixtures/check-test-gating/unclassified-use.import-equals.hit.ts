import * as vitest from "vitest";
import skipSuite = vitest.describe.skip; // HIT
skipSuite("through an import-equals alias of describe.skip", () => {});
import * as integration from "../../../scripts/test-utils/integration.mjs";
import gatedDescribe = describe.skipIf; // HIT
import factory = integration.integrationSuite; // HIT
import hookAlias = vitest.beforeAll; // HIT
import viAlias = vitest.vi; // HIT
