// Cloudflare Worker in front of askdb.tools (GitHub Pages), for the content negotiation GitHub
// Pages can't do. A GET or HEAD that prefers `text/markdown` gets a page's Markdown twin, or a
// Markdown 404; one that prefers `application/json` and 404s gets a JSON error. Everything else
// passes through, and an HTML response says `Vary: Accept`.
import { markdownPathFor } from "../src/utils/markdown-twin.ts";
import { notFoundJson, notFoundMarkdown } from "../src/utils/not-found.mjs";

const MARKDOWN = "text/markdown";
const JSON_TYPE = "application/json";
const HTML = "text/html";

/**
 * The type an `Accept` header prefers among Markdown, JSON and HTML. Markdown or JSON wins only
 * when it is named with a quality at least as high as HTML's, so `*\/*` and a browser's `Accept`
 * get HTML.
 */
export function preferredType(accept) {
  const quality = new Map();
  for (const part of (accept ?? "").toLowerCase().split(",")) {
    const [type, ...params] = part.split(";").map((s) => s.trim());
    const q = params.find((param) => param.startsWith("q="));
    quality.set(type, q ? Number(q.slice(2)) || 0 : 1);
  }
  const html = quality.get(HTML) ?? quality.get("text/*") ?? quality.get("*/*") ?? 0;
  const best = [MARKDOWN, JSON_TYPE]
    .map((type) => ({ type, q: quality.get(type) ?? 0 }))
    .reduce((a, b) => (b.q > a.q ? b : a));
  return best.q > 0 && best.q >= html ? best.type : HTML;
}

const withVary = (response) => {
  const varied = new Response(response.body, response);
  varied.headers.append("Vary", "Accept");
  return varied;
};

export async function handle(request, fetchOrigin) {
  const response = await fetchOrigin(request);
  if (request.method !== "GET" && request.method !== "HEAD") return response;
  const isHtml = (response.headers.get("content-type") ?? "").startsWith(HTML);
  const type = preferredType(request.headers.get("accept"));
  const url = new URL(request.url);
  const siteUrl = `${url.origin}/`;
  const reply = (body, status, contentType, extra = {}) =>
    new Response(request.method === "HEAD" ? null : body, {
      status,
      headers: { "Content-Type": contentType, Vary: "Accept", ...extra },
    });

  if (response.status === 404 && type !== HTML) {
    const extra = { "Cache-Control": "no-store", Link: `<${siteUrl}llms.txt>; rel="help"` };
    return type === MARKDOWN
      ? reply(notFoundMarkdown(siteUrl, url.pathname), 404, "text/markdown; charset=utf-8", extra)
      : reply(JSON.stringify(notFoundJson(siteUrl, url.pathname)), 404, "application/json; charset=utf-8", extra);
  }
  if (response.ok && isHtml && type === MARKDOWN) {
    // Joined as a string, not resolved as a URL: a path such as `//x/` would otherwise name a host.
    const twin = await fetchOrigin(new Request(`${url.origin}${markdownPathFor(url.pathname)}`));
    if (twin.ok) return reply(await twin.text(), 200, "text/markdown; charset=utf-8");
  }
  return isHtml ? withVary(response) : response;
}

export default { fetch: (request) => handle(request, fetch) };
