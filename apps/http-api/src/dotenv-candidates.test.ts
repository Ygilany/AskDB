import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { dotenvCandidates } from "./dotenv-candidates.js";

// askdb-http loads the first of these `.env` files that exists (#839). The working directory's
// comes first. The package folder's and the repo root's are tried only from AskDB's own source
// checkout, and never inside node_modules.
describe("dotenvCandidates", () => {
  it.each([
    ["an npm install", "/app/node_modules/@askdb/http-api/dist"],
    ["a pnpm install", "/app/node_modules/.pnpm/@askdb+http-api@1.0.0/node_modules/@askdb/http-api/dist"],
    ["a package folder copied out of node_modules", "/opt/askdb-http/dist"],
  ])("in %s, tries only the working directory's .env", (_layout, binDir) => {
    expect(dotenvCandidates(resolve(binDir), resolve("/app"), false)).toEqual([resolve("/app/.env")]);
  });

  // Inside AskDB's own repo, the package folder's and the repo root's `.env` still follow.
  it.each([
    ["the package folder", "/repo/apps/http-api", ["/repo/apps/http-api/.env", "/repo/.env"]],
    ["the repo root", "/repo", ["/repo/.env", "/repo/apps/http-api/.env"]],
    ["another directory", "/work", ["/work/.env", "/repo/apps/http-api/.env", "/repo/.env"]],
  ])("in AskDB's source checkout, run from %s, tries the working directory's .env first", (_from, cwd, expected) => {
    expect(dotenvCandidates(resolve("/repo/apps/http-api/dist"), resolve(cwd), true)).toEqual(expected.map((p) => resolve(p)));
  });

  it("never tries a candidate inside node_modules, even from a source checkout", () => {
    expect(dotenvCandidates(resolve("/app/node_modules/askdb/apps/http-api/dist"), resolve("/app"), true)).toEqual([
      resolve("/app/.env"),
    ]);
  });
});
