// Where the environment may be read: a test body, a Vitest hook, integrationSuite()'s options, a
// plain const (used only in those places), and a named function (called only from them).
import { integrationSuite } from "../../../scripts/test-utils/integration.mjs";
const url = process.env.DATABASE_URL;
const pgvector = process.env.ASKDB_PGVECTOR_URL ?? process.env.PGVECTOR_URL;
const { MY_AI, MY_DB = "" } = process.env;
const originalCwd = process.cwd();
const here = new URL(".", import.meta.url);
function spawnEnv() { return { ...process.env, CI: "1" }; }
const connect = () => url ?? pgvector;
beforeAll(() => { process.env.MY_AI = "x"; connect(); });
afterEach(() => { process.chdir(originalCwd); process.env.MY_AI = MY_AI; });
it("reads the environment in a test", () => { expect(process.env.CI ?? spawnEnv()).toBeDefined(); });
integrationSuite({ env: [process.env.CI ? "DATABASE_URL" : "DATABASE_URL"] })("an integration suite", () => {
  it("uses the url", () => { expect(url ?? MY_DB).toBeDefined(); });
});
describe.each([here.href])("a table built from the file's own URL %s", () => {});
const holder = { url, pgvector };
it("reads a const that holds the environment", () => { expect(holder).toBeDefined(); });
describe("a suite body holding a plain const", () => {
  const suiteUrl = process.env.DATABASE_URL;
  it("uses it", () => { expect(suiteUrl).toBeDefined(); });
});
