import { unified } from "@astrojs/markdown-remark";
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import astroD2 from "astro-d2";
import starlightLlmsTxt from "starlight-llms-txt";

const base = process.env.ASTRO_BASE ?? "/";
const normalizedBase = base === "/" ? "" : base.replace(/\/$/, "");
const site = process.env.ASTRO_SITE ?? "https://askdb.tools";

/**
 * Remark plugin that rewrites root-absolute internal links (e.g. `/quickstart/`)
 * to be relative to the configured base path (e.g. `/AskDB/quickstart/`).
 * This handles both Markdown links and JSX <a href="…"> elements inside .mdx files.
 * When base is "/" the plugin is a no-op so local `astro dev` is unaffected.
 */
function remarkRebaseLinks() {
  if (!normalizedBase) return (_tree) => {};

  function walk(node) {
    if (node.type === "link") {
      if (typeof node.url === "string" && node.url.startsWith("/") && !node.url.startsWith("//")) {
        node.url = normalizedBase + node.url;
      }
    } else if (node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement") {
      if (node.name === "a") {
        const hrefAttr = (node.attributes ?? []).find(
          (a) => a.type === "mdxJsxAttribute" && a.name === "href"
        );
        if (hrefAttr && typeof hrefAttr.value === "string" &&
            hrefAttr.value.startsWith("/") && !hrefAttr.value.startsWith("//")) {
          hrefAttr.value = normalizedBase + hrefAttr.value;
        }
      }
    }
    if (node.children) node.children.forEach(walk);
  }

  return (tree) => walk(tree);
}

export default defineConfig({
  site: `${site}${normalizedBase}`,
  base,
  // Pages that moved or were deleted. A static build writes each one as a page that forwards the
  // reader (a meta refresh), so old links and bookmarks still land. Astro adds the base to the
  // old path but not to the destination, so the destination carries it here.
  redirects: {
    "/reference/ask-options": `${normalizedBase}/reference/core-api/`,
    "/getting-started/troubleshooting": `${normalizedBase}/guides/troubleshooting/`,
  },
  markdown: {
    processor: unified({ remarkPlugins: [remarkRebaseLinks] }),
  },
  integrations: [
    // Diagrams: ```d2 fences (or `src` files under src/assets/diagrams/d2/) render to inline SVG
    // at build time through D2's WebAssembly build, so CI and the Pages deploy need no D2 binary.
    // D2's own dark theme is off: src/styles/custom.css maps D2's palette classes to Starlight's
    // color variables, so a diagram follows the site's theme toggle.
    astroD2({ experimental: { useD2js: true }, inline: true, pad: 16, theme: { dark: false } }),
    starlight({
      head: [
        {
          tag: "script",
          attrs: {
            defer: true,
            src: "https://static.cloudflareinsights.com/beacon.min.js",
            "data-cf-beacon": '{"token": "d88bd06a11b7436eafb44804cb2fabbf"}',
          },
        },
      ],
      title: "AskDB",
      description:
        "Open-source NL-to-SQL toolkit for developers. Your LLM generates schema-grounded SQL; your app runs it.",
      logo: {
        light: "./src/assets/brand/logo.png",
        dark: "./src/assets/brand/logo-dark.png",
        alt: "AskDB",
        replacesTitle: true,
      },
      favicon: "/favicon-light.png",
      customCss: ["./src/styles/custom.css"],
      components: {
        Header: "./src/components/overrides/Header.astro",
        Hero: "./src/components/overrides/Hero.astro",
        ThemeSelect: "./src/components/ThemeSelect.astro",
        Footer: "./src/components/overrides/Footer.astro",
      },
      editLink: {
        baseUrl: "https://github.com/Ygilany/AskDB/edit/main/apps/docs-site/",
      },
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/Ygilany/AskDB",
        },
      ],
      plugins: [
        starlightLlmsTxt({
          details:
            "AskDB is an open-source NL-to-SQL toolkit: `ask({ question, schema, model, dialect })` from `@askdb/core` takes a schema artifact and a Vercel AI SDK `LanguageModel`, and returns SQL that has passed heuristic checks. It never executes SQL — the host application runs it through its own connection. The same pipeline powers the CLI, the `@askdb/client` library, `@askdb/http-api`, and Studio.\n" +
            "\n" +
            "The docs site is organized as Start (quickstart, install, Studio), Guides (embedding in Node, HTTP deployment, multi-tenancy, RAG for large schemas, switching engines, bringing your own model, upgrading between releases, agent/MCP integration), Concepts (how AskDB works, the schema artifact, safety boundaries, privacy model, tenant isolation, modes and dialects), and Reference (CLI, HTTP API, configuration, the full package map, API docs). The full per-page index is in the linked documentation sets below.\n" +
            "\n" +
            "Two things worth knowing before implementing: (1) wiring the AI model is a two-path choice — config-driven `@askdb/client`/`@askdb/ai` (built-in providers; install the matching `@ai-sdk/*` package) vs. a raw Vercel AI SDK model passed to `ask()` — decided by who owns provider config in the host app; see /guides/bring-your-own-model/. (2) Tenant scope and sensitive-field handling are host-application responsibilities. AskDB validates the scope shape, binds tenant IDs, and runs heuristic checks, but never originates scope and isn't the enforcement boundary; see /concepts/safety-boundaries/, and /guides/enforce-tenancy-in-the-database/ for Postgres row-level security.\n" +
            "\n" +
            "For a project-onboarding map written specifically for coding agents implementing AskDB elsewhere, see /AGENTS.md.",
        }),
      ],
      sidebar: [
        {
          label: "Start",
          items: [
            { label: "Overview", slug: "index" },
            { label: "Quickstart", slug: "quickstart" },
            { label: "Install", slug: "install" },
            { label: "Studio tour", slug: "studio" },
          ],
        },
        {
          label: "Guides",
          items: [
            {
              label: "Build",
              items: [
                { label: "Embed in a Node app", slug: "guides/embed-in-node" },
                { label: "Author your schema", slug: "guides/author-your-schema" },
                { label: "Introspect without a connection", slug: "guides/introspect-without-a-connection" },
                { label: "Bring your own model", slug: "guides/bring-your-own-model" },
                { label: "Switch engines", slug: "guides/switch-engines" },
                { label: "Connect to SQL Server", slug: "guides/connect-to-sql-server" },
                { label: "RAG for large schemas", slug: "guides/rag-for-large-schemas" },
                { label: "Rerun a query with new values", slug: "guides/rerun-a-query-with-new-values" },
                { label: "Bundle an app that uses AskDB", slug: "guides/bundle-your-app" },
              ],
            },
            {
              label: "Run in production",
              items: [
                { label: "Run safely in production", slug: "guides/run-safely-in-prod" },
                { label: "Cap the rows a query returns", slug: "guides/cap-the-rows-a-query-returns" },
                { label: "Keep sensitive columns out of prompts", slug: "guides/keep-sensitive-columns-out-of-prompts" },
                { label: "Deploy as HTTP service", slug: "guides/deploy-as-http-service" },
                { label: "Enable Studio execute", slug: "guides/enable-studio-execute" },
              ],
            },
            {
              label: "Tenancy",
              items: [
                { label: "Scope queries to a tenant", slug: "guides/multi-tenancy" },
                { label: "Scope to a tenant hierarchy", slug: "guides/tenant-hierarchy" },
                { label: "Enforce tenancy in the database", slug: "guides/enforce-tenancy-in-the-database" },
              ],
            },
            {
              label: "Maintain",
              items: [
                { label: "Upgrade AskDB", slug: "guides/upgrading" },
                { label: "Fix common errors", slug: "guides/troubleshooting" },
              ],
            },
            {
              label: "Integrations",
              items: [
                { label: "Prisma", slug: "guides/integrations/prisma" },
                { label: "Agents & MCP", slug: "guides/integrations/agents-mcp" },
              ],
            },
          ],
        },
        {
          label: "Concepts",
          items: [
            { label: "How AskDB works", slug: "concepts/how-askdb-works" },
            { label: "The schema artifact", slug: "concepts/the-schema-artifact" },
            { label: "Safety boundaries", slug: "concepts/safety-boundaries" },
            { label: "Modes and dialects", slug: "concepts/modes-and-dialects" },
            { label: "Privacy model", slug: "concepts/privacy-model" },
            { label: "Tenant isolation", slug: "concepts/tenant-isolation" },
          ],
        },
        {
          label: "Reference",
          items: [
            {
              label: "Surfaces",
              items: [
                { label: "CLI", slug: "reference/cli" },
                { label: "HTTP API", slug: "reference/http-api" },
                { label: "Configuration", slug: "reference/config" },
                { label: "Studio", slug: "reference/studio" },
              ],
            },
            {
              label: "Formats and rules",
              items: [
                { label: "Schema artifact format", slug: "reference/schema-artifact-format" },
                { label: "Tenant policy format", slug: "reference/tenant-policy" },
              ],
            },
            {
              label: "Packages and releases",
              items: [{ label: "Packages", slug: "reference/packages" }],
            },
            {
              label: "APIs",
              items: [
                {
                  label: "@askdb/core API",
                  collapsed: true,
                  items: [
                    { label: "Overview", slug: "reference/core-api" },
                    { label: "ask()", slug: "reference/core-api/ask" },
                    { label: "bindPreparedQuery()", slug: "reference/core-api/rebind" },
                    { label: "Tenant scope", slug: "reference/core-api/tenancy" },
                    { label: "Checks", slug: "reference/core-api/checks" },
                    { label: "Schema loading", slug: "reference/core-api/schema" },
                    { label: "Dialects", slug: "reference/core-api/dialects" },
                    { label: "Logging", slug: "reference/core-api/logging" },
                    { label: "Errors", slug: "reference/core-api/errors" },
                  ],
                },
                { label: "@askdb/client API", slug: "reference/client-api" },
                { label: "@askdb/config API", slug: "reference/config-api" },
                { label: "@askdb/ai API", slug: "reference/ai-api" },
                { label: "@askdb/rag API", slug: "reference/rag-api" },
                { label: "Introspection API", slug: "reference/introspect-api" },
              ],
            },
          ],
        },
      ],
    }),
  ],
});
