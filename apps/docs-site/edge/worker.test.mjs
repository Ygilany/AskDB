import assert from "node:assert/strict";
import { test } from "node:test";
import { handle, preferredType } from "./worker.mjs";

// A stand-in for GitHub Pages: the files it holds, and `404.html` for anything else.
const site = (files) => async (request) => {
  const path = new URL(request.url).pathname;
  const file = files[path];
  return file
    ? new Response(file.body, { status: 200, headers: { "Content-Type": file.type } })
    : new Response("<!DOCTYPE html>404", { status: 404, headers: { "Content-Type": "text/html; charset=utf-8" } });
};
const origin = site({
  "/": { body: "<!DOCTYPE html>home", type: "text/html; charset=utf-8" },
  "/index.md": { body: "# AskDB\n", type: "text/markdown; charset=utf-8" },
  "/quickstart/": { body: "<!DOCTYPE html>quickstart", type: "text/html; charset=utf-8" },
  "/quickstart.md": { body: "# Quickstart\n", type: "text/markdown; charset=utf-8" },
  "/old/": { body: "<!DOCTYPE html>redirect", type: "text/html; charset=utf-8" },
  "/llms.txt": { body: "# AskDB", type: "text/plain; charset=utf-8" },
});
const request = (path, accept, method = "GET") => new Request(`https://askdb.tools${path}`, { method, headers: { Accept: accept } });

test("Markdown or JSON is preferred only when named at least as high as HTML", () => {
  assert.equal(preferredType("text/markdown"), "text/markdown");
  assert.equal(preferredType("text/html, text/markdown"), "text/markdown");
  assert.equal(preferredType("application/json"), "application/json");
  assert.equal(preferredType("application/json, */*;q=0.8"), "application/json");
  assert.equal(preferredType("text/html,application/xhtml+xml,*/*;q=0.8"), "text/html");
  assert.equal(preferredType("text/html, text/markdown;q=0.5"), "text/html");
  assert.equal(preferredType("text/markdown;q=0"), "text/html");
  assert.equal(preferredType("*/*"), "text/html");
  assert.equal(preferredType(null), "text/html");
});

test("the home page and a docs page asked for as Markdown get their Markdown twin", async () => {
  for (const [path, heading] of [["/", "# AskDB\n"], ["/quickstart/", "# Quickstart\n"]]) {
    const response = await handle(request(path, "text/markdown"), origin);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "text/markdown; charset=utf-8");
    assert.equal(response.headers.get("vary"), "Accept");
    assert.equal(await response.text(), heading);
  }
});

test("a path that starts with // fetches its twin from the same origin, never from another host", async () => {
  const fetched = [];
  const recording = async (req) => {
    fetched.push(new URL(req.url).host);
    return new Response("<!DOCTYPE html>", { status: 200, headers: { "Content-Type": "text/html" } });
  };
  await handle(new Request("https://askdb.tools//quickstart/", { headers: { Accept: "text/markdown" } }), recording);
  assert.deepEqual(fetched, ["askdb.tools", "askdb.tools"]);
});

test("a page asked for as HTML stays HTML and says Vary: Accept", async () => {
  const response = await handle(request("/", "text/html"), origin);
  assert.equal(response.headers.get("content-type"), "text/html; charset=utf-8");
  assert.equal(response.headers.get("vary"), "Accept");
  assert.equal(await response.text(), "<!DOCTYPE html>home");
});

test("a page with no twin, and a file that isn't HTML, pass through", async () => {
  const redirect = await handle(request("/old/", "text/markdown"), origin);
  assert.equal(await redirect.text(), "<!DOCTYPE html>redirect");
  const llms = await handle(request("/llms.txt", "text/markdown"), origin);
  assert.equal(llms.headers.get("content-type"), "text/plain; charset=utf-8");
  assert.equal(llms.headers.get("vary"), null);
});

test("a missing path asked for as Markdown keeps its 404 and gets a Markdown body", async () => {
  const response = await handle(request("/nope", "text/markdown"), origin);
  assert.equal(response.status, 404);
  assert.equal(response.headers.get("content-type"), "text/markdown; charset=utf-8");
  assert.equal(response.headers.get("vary"), "Accept");
  assert.equal(response.headers.get("link"), '<https://askdb.tools/llms.txt>; rel="help"');
  assert.match(await response.text(), /^# Page not found\n\nThere is no page at `\/nope`/);
});

test("a missing path asked for as JSON keeps its 404 and gets a JSON error with a hint", async () => {
  const response = await handle(request("/api/nope", "application/json"), origin);
  assert.equal(response.status, 404);
  assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.equal(body.error.code, "not_found");
  assert.equal(body.error.message, "There is no page at /api/nope.");
  assert.equal(typeof body.error.hint, "string");
  assert.equal(body.error.docs, "https://askdb.tools/llms.txt");
});

test("a HEAD gets the negotiated headers and no body", async () => {
  const missing = await handle(request("/nope", "text/markdown", "HEAD"), origin);
  assert.equal(missing.status, 404);
  assert.equal(missing.headers.get("content-type"), "text/markdown; charset=utf-8");
  assert.equal(await missing.text(), "");
  const page = await handle(request("/quickstart/", "text/markdown", "HEAD"), origin);
  assert.equal(page.headers.get("content-type"), "text/markdown; charset=utf-8");
  assert.equal(await page.text(), "");
});

test("a browser's 404 is the HTML page, and a POST passes through untouched", async () => {
  const browser = await handle(request("/nope", "text/html,*/*;q=0.8"), origin);
  assert.equal(browser.status, 404);
  assert.equal(await browser.text(), "<!DOCTYPE html>404");
  const post = await handle(request("/nope", "text/markdown", "POST"), origin);
  assert.equal(post.headers.get("vary"), null);
  assert.equal(await post.text(), "<!DOCTYPE html>404");
});
