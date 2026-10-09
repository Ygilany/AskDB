import cjs = require("vitest");
const { describe: dynamicDescribe } = await import("vitest");
dynamicDescribe.skip("dynamic import, destructured", () => {}); // HIT
const dyn = await import("vitest");
dyn.describe.skip("dynamic import namespace", () => {}); // HIT
cjs.describe.skip("import = require", () => {}); // HIT
const req = require("vitest");
req.describe.skip("require", () => {}); // HIT
