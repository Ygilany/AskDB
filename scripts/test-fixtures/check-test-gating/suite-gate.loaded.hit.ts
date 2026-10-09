import cjs = require("vitest");
import { createRequire } from "node:module";
import qualified = cjs.describe;
const { describe: dynamicDescribe } = await import("vitest");
dynamicDescribe.skip("dynamic import, destructured", () => {}); // HIT
const dyn = await import("vitest");
dyn.describe.skip("dynamic import namespace", () => {}); // HIT
cjs.describe.skip("import = require", () => {}); // HIT
const req = require("vitest");
req.describe.skip("require", () => {}); // HIT
require("vitest").describe.skip("member read off require", () => {}); // HIT
(await import("vitest")).describe.skip("member read off an awaited import", () => {}); // HIT
const tpl = await import(`vitest`);
tpl.describe.skip("template-literal specifier", () => {}); // HIT
const localRequire = createRequire(import.meta.url);
localRequire("vitest").describe.skip("through createRequire", () => {}); // HIT
(await import("vitest", {})).describe.skip("two-argument import", () => {}); // HIT
require(("vitest") as string).describe.skip("cast specifier", () => {}); // HIT
module.require("vitest").describe.skip("module.require", () => {}); // HIT
globalThis.require("vitest").describe.skip("globalThis.require", () => {}); // HIT
qualified.skip("import d = v.describe", () => {}); // HIT
// check-test-gating-ignore-next-line: exercises gating through an exempted alias
const exemptedAlias = require("vitest").describe;
exemptedAlias.skip("through an alias whose own line is exempted", () => {}); // HIT
const moduleRequire = module.createRequire(import.meta.url);
moduleRequire("vitest").describe.skip("through module.createRequire", () => {}); // HIT
const actual = await vi.importActual<typeof import("vitest")>("vitest");
actual.describe.skipIf(!process.env.DATABASE_URL)("through vi.importActual", () => {}); // HIT
const mocked = await vi.importMock("vitest");
mocked.describe.skip("through vi.importMock", () => {}); // HIT
