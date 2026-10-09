import * as vitest from "vitest";
import { describe as group, it as check } from "vitest";
vitest.describe.skip("through a namespace import", () => {}); // HIT
vitest.describe.skipIf(!process.env.DATABASE_URL)("namespace, gated", () => {}); // HIT
group.skip("through a renamed import", () => {}); // HIT
group("renamed suite", () => {
  check("renamed test", () => {});
});
vitest["describe"].skipIf(!process.env.DATABASE_URL)("element access on the namespace", () => {}); // HIT
