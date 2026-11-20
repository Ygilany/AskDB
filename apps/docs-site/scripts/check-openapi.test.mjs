import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { errorCodes, openapiProblems, readServerSources, serverRoutes } from "./check-openapi.mjs";

const source = JSON.parse(await readFile(new URL("../src/openapi.json", import.meta.url), "utf8"));
const versioned = (doc) => ({ ...doc, info: { ...doc.info, version: "1.0.0" } });

test("the OpenAPI document matches askdb-http's routes and error codes", async () => {
  const sources = await readServerSources();
  assert.deepEqual([...serverRoutes(sources.serverSource)].sort(), ["GET /health", "POST /ask"]);
  assert.ok(errorCodes(sources.typesSource).has("question_declined"));
  assert.deepEqual(openapiProblems(versioned(source), sources), []);
});

test("openapiProblems reports a missing route, a missing error code, a broken $ref and no version", () => {
  const sources = {
    serverSource: `if (method === "GET" && url === "/health") {} if (method !== "POST" || url !== "/ask") {} if (method === "GET" && url === "/new") {}`,
    typesSource: `code:\n | "not_found"\n | "brand_new";`,
  };
  const doc = { openapi: "3.1.0", info: { title: "t" }, paths: { "/health": { get: {} }, "/ask": { post: { $ref: "#/components/nope" } } }, components: { schemas: { AskHttpErrorResponse: { properties: { error: { properties: { code: { enum: ["not_found"] } } } } } } } };
  assert.deepEqual(openapiProblems(doc, sources), [
    "info needs a title and a version",
    "paths list GET /health, POST /ask, but the server answers GET /health, GET /new, POST /ask",
    "error codes are not_found, but types.ts declares brand_new, not_found",
    "$ref #/components/nope points nowhere",
  ]);
});

test("finding no routes or error codes fails instead of passing", () => {
  assert.deepEqual(openapiProblems(versioned(source), { serverSource: "", typesSource: "" }), [
    "found no routes in server.ts",
    "found no error codes in types.ts",
  ]);
});
