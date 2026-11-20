// Fails when /openapi.json drifts from askdb-http: a route the server answers that the document
// doesn't list (or the reverse), an error code that apps/http-api/src/types.ts declares and the
// document doesn't (or the reverse), or a `$ref` that points nowhere.
//
// It reads the server's source with small regexes, not the TypeScript compiler, and fails closed:
// finding no routes or no error codes is a problem, not a pass.
import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const repoRoot = new URL("../../../", import.meta.url);

/** The `METHOD /path` routes server.ts answers. */
export function serverRoutes(serverSource) {
  const routes = new Set();
  for (const [, method, path] of serverSource.matchAll(/method === "(\w+)" && url === "([^"]+)"/g)) routes.add(`${method} ${path}`);
  for (const [, method, path] of serverSource.matchAll(/method !== "(\w+)" \|\| url !== "([^"]+)"/g)) routes.add(`${method} ${path}`);
  return routes;
}

/** The error codes in `AskHttpErrorResponse`'s `code` union. */
export function errorCodes(typesSource) {
  const union = /code:\s*((?:\|\s*"[^"]+"\s*)+);/.exec(typesSource)?.[1] ?? "";
  return new Set([...union.matchAll(/"([^"]+)"/g)].map(([, code]) => code));
}

const sameSet = (a, b) => a.size === b.size && [...a].every((item) => b.has(item));
const list = (set) => [...set].sort().join(", ");

/** What's wrong with an OpenAPI document `doc`, given askdb-http's server.ts and types.ts. */
export function openapiProblems(doc, { serverSource, typesSource }) {
  const problems = [];
  if (doc.openapi !== "3.1.0") problems.push(`openapi is ${JSON.stringify(doc.openapi)}, not "3.1.0"`);
  if (typeof doc.info?.title !== "string" || typeof doc.info?.version !== "string" || doc.info.version === "") {
    problems.push("info needs a title and a version");
  }

  const routes = serverRoutes(serverSource);
  const documented = new Set(Object.entries(doc.paths ?? {}).flatMap(([path, item]) => Object.keys(item).map((method) => `${method.toUpperCase()} ${path}`)));
  if (routes.size === 0) problems.push("found no routes in server.ts");
  else if (!sameSet(routes, documented)) problems.push(`paths list ${list(documented)}, but the server answers ${list(routes)}`);

  const codes = errorCodes(typesSource);
  const enumCodes = new Set(doc.components?.schemas?.AskHttpErrorResponse?.properties?.error?.properties?.code?.enum ?? []);
  if (codes.size === 0) problems.push("found no error codes in types.ts");
  else if (!sameSet(codes, enumCodes)) problems.push(`error codes are ${list(enumCodes)}, but types.ts declares ${list(codes)}`);

  for (const [, ref] of JSON.stringify(doc).matchAll(/"\$ref":"([^"]+)"/g)) {
    const target = ref.replace(/^#\//, "").split("/").reduce((node, key) => node?.[key], doc);
    if (!ref.startsWith("#/") || target === undefined) problems.push(`$ref ${ref} points nowhere`);
  }
  return problems;
}

export async function readServerSources() {
  const read = (path) => readFile(new URL(path, repoRoot), "utf8");
  return { serverSource: await read("apps/http-api/src/server.ts"), typesSource: await read("apps/http-api/src/types.ts") };
}

// Checks the built document. Compare real paths, so a run through a symbolic link still runs it.
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const doc = JSON.parse(await readFile(new URL("../dist/openapi.json", import.meta.url), "utf8"));
  const problems = openapiProblems(doc, await readServerSources());
  if (problems.length > 0) {
    console.error(`Found ${problems.length} problem(s) with /openapi.json:`);
    for (const problem of problems) console.error(`- ${problem}`);
    process.exit(1);
  }
  console.log("/openapi.json matches askdb-http's routes and error codes.");
}
