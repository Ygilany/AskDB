import * as vitest from "vitest";
import skipSuite = vitest.describe.skip; // HIT
skipSuite("through an import-equals alias of describe.skip", () => {});
