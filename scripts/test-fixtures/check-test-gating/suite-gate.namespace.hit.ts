import * as vitest from "vitest";
import { describe as group, it as check } from "vitest";
vitest.describe.skip("through a namespace import", () => {}); // HIT
vitest.describe.skipIf(!process.env.DATABASE_URL)("namespace, gated", () => {}); // HIT
group.skip("through a renamed import", () => {}); // HIT
group("renamed suite", () => {
  check("renamed test", () => {});
});
vitest["describe"].skipIf(!process.env.DATABASE_URL)("element access on the namespace", () => {}); // HIT
const { describe: viaDestructuring } = vitest;
viaDestructuring.skip("through a destructured namespace", () => {}); // HIT
const alias = vitest;
alias.describe.skip("through a namespace alias", () => {}); // HIT
(vitest as any).describe.skip("through a cast namespace", () => {}); // HIT
import.meta.vitest!.describe.skipIf(!process.env.DATABASE_URL)("in-source tests through import.meta.vitest", () => {}); // HIT
const inSource = import.meta.vitest!;
inSource.describe.skip("import.meta.vitest held in a const", () => {}); // HIT
const { describe: inSourceDescribe } = (import.meta as any).vitest;
inSourceDescribe.skip("import.meta.vitest destructured", () => {}); // HIT
