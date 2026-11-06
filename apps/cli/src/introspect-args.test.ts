import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runIntrospectCli } from "./introspect.js";

let stdout = "";
let stderr = "";

beforeEach(() => {
  stdout = "";
  stderr = "";
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdout += String(chunk);
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr += String(chunk);
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// `templates` parses every flag without reading askdb.config, so these run anywhere.
describe("askdb introspect arguments", () => {
  it.each<[string, string[], string]>([
    ["an unknown --flag=value", ["--urll=postgres://u:secret@h/db"], "Unknown option: --urll\n"],
    [
      "a stray positional",
      ["postgres://u:secret@h/db"],
      "Unexpected argument: askdb introspect takes no positional arguments. Pass values with their flag, such as --url <url>.\n",
    ],
    ["a value on a switch", ["--print=secret"], "--print takes no value.\n"],
  ])("never repeats %s in its error", async (_case, args, message) => {
    expect(await runIntrospectCli(["templates", "--engine", "postgres", ...args])).toBe(1);
    expect(stderr).toBe(message);
  });

  it("takes --flag=value like --flag value, as askdb rag does", async () => {
    expect(await runIntrospectCli(["templates", "--engine=postgres"])).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain("-- schemas");
  });
});
