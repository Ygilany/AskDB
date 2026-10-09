import { describe as group } from "./not-vitest";
import { expect as assertThat } from "vitest";
import * as other from "other-lib";
group.skip("a local helper named like a suite");
const notATestFn = assertThat.skip;
other.describe.skip("not Vitest's describe");
import * as v from "vitest";
const e = v.expect;
(v as any).expect(1);
const pkg = "vitest";
expect(deps).toContain(pkg);
namespace Local {
  export const describe = { skip: 1 };
}
import localDescribe = Local.describe;
const notVitest = localDescribe.skip;
