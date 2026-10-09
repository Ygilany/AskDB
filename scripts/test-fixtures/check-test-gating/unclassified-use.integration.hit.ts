import { integrationSuite } from "../../scripts/test-utils/integration.mjs";
import * as integration from "../../scripts/test-utils/integration.mjs";
const gate = integrationSuite; // HIT
register(integration); // HIT
const aliased = integration.integrationSuite; // HIT
