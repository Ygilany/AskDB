// The docs site's "page not found" bodies. The Markdown one is served at `/404.md`
// (src/pages/404.md.ts); the edge worker (edge/worker.mjs) sends either with the 404 status,
// since GitHub Pages can only send `404.html`.

const cleanPath = (path) => path.replace(/[`\r\n]/g, "");

/** `siteUrl` ends in `/`. `path` is a URL pathname, so it is already percent-encoded. */
export function notFoundMarkdown(siteUrl, path) {
  const missing = path ? `There is no page at \`${cleanPath(path)}\`.` : "There is no page at this address.";
  return `# Page not found

${missing} It may have moved, or the address may be mistyped.

- [AskDB documentation](${siteUrl}): the home page of the docs.
- [llms.txt](${siteUrl}llms.txt): the index of the docs for agents.
- [Sitemap](${siteUrl}sitemap-index.xml): every page on the site.

Every docs page has a Markdown version at its URL with the trailing slash replaced by \`.md\`.
`;
}

/** The JSON "page not found" body, in the error shape askdb-http uses, with a hint and links. */
export function notFoundJson(siteUrl, path) {
  return {
    ok: false,
    error: {
      code: "not_found",
      message: `There is no page at ${cleanPath(path)}.`,
      hint: "Check the address, or find the page in llms.txt or the sitemap. askdb.tools serves docs; askdb-http, AskDB's HTTP API, runs on your own server.",
      docs: `${siteUrl}llms.txt`,
      sitemap: `${siteUrl}sitemap-index.xml`,
      openapi: `${siteUrl}openapi.json`,
    },
  };
}
