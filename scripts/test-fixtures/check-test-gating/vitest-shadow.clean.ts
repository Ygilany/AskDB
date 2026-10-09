import { describe } from "./helpers";
import test from "./default-helper";
import * as it from "./namespace-helper";
describe.skip("a named import from another module");
test.skipIf(!ready)("a default import named test");
const value = it.skip;
const exported = { describe };
function it(a: string): void;
function it(a: any) {}
it("an overloaded local function named it");
