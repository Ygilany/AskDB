// The OpenAPI document of askdb-http (@askdb/http-api), at `/openapi.json`. Its version is the
// package's, so a release can't leave it behind. scripts/check-openapi.mjs keeps its routes and
// error codes in step with the server.
import type { APIRoute } from "astro";
import httpApi from "../../../http-api/package.json";
import openapi from "../openapi.json";

export const prerender = true;

export const GET: APIRoute = () => {
  const document = { ...openapi, info: { ...openapi.info, version: httpApi.version } };
  return new Response(`${JSON.stringify(document, null, 2)}\n`, { headers: { "Content-Type": "application/json" } });
};
