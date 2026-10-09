import cjs = require("vitest");
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
