import { fileURLToPath } from "node:url";
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

const base = process.env.ASTRO_BASE ?? "/";
const normalizedBase = base === "/" ? "" : base.replace(/\/$/, "");

/** Old slug kept as redirect for bookmarks and external links (single entry avoids Astro route collision). */
const schemaSlugRedirects = (() => {
  const from = normalizedBase ? `${normalizedBase}/schema-v2/` : "/schema-v2/";
  const to = normalizedBase ? `${normalizedBase}/askdb-schema/` : "/askdb-schema/";
  return { [from]: to };
})();

/** Starlight does not export `user-components/Icon.astro` in package.json `exports`. */
const starlightIcon = fileURLToPath(
  new URL("node_modules/@astrojs/starlight/user-components/Icon.astro", import.meta.url)
);

export default defineConfig({
  site: `https://ygilany.github.io${normalizedBase}`,
  base,
  redirects: schemaSlugRedirects,
  vite: {
    resolve: {
      alias: {
        "@starlight/icon": starlightIcon,
      },
    },
  },
  integrations: [
    starlight({
      title: "AskDB",
      description:
        "Natural language to validated SQL—grounded in your schema so models never need your rows. npm-first guides for embed, CLI, and HTTP.",
      logo: {
        light: "./src/assets/brand/logo.png",
        dark: "./src/assets/brand/logo-dark.png",
        alt: "AskDB",
        replacesTitle: true,
      },
      favicon: "/favicon-light.png",
      customCss: ["./src/styles/custom.css"],
      components: {
        Hero: "./src/components/overrides/Hero.astro",
        ThemeSelect: "./src/components/ThemeSelect.astro",
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
      sidebar: [
        {
          label: "Start",
          items: [
            { label: "Overview", slug: "index" },
            { label: "Quickstart", slug: "quickstart" },
            { label: "Journeys", slug: "journeys" },
            { label: "Core concepts", slug: "concepts" },
            { label: "Architecture", slug: "architecture" },
          ],
        },
        {
          label: "Guides",
          items: [
            { label: "Embed NL→SQL in a Node app", slug: "guides/embed-in-app" },
            { label: "Author and enrich schema", slug: "guides/author-enrich-schema" },
            { label: "Add RAG for large schemas", slug: "guides/rag-large-schema" },
            { label: "Run the HTTP API", slug: "guides/http-api" },
            { label: "Agents and MCP (status)", slug: "guides/agents-and-mcp" },
          ],
        },
        {
          label: "Reference",
          items: [
            { label: "Package reference", slug: "packages" },
            { label: "@askdb/config", slug: "environment" },
            { label: "@askdb/core", slug: "core" },
            { label: "@askdb/postgres", slug: "postgres" },
            { label: "@askdb/prisma", slug: "prisma" },
            { label: "askdb", slug: "cli" },
            { label: "@askdb/introspect", slug: "introspect" },
            { label: "@askdb/enrich", slug: "enrich" },
            { label: "@askdb/tui", slug: "tui" },
            { label: "@askdb/studio", slug: "studio" },
            { label: "@askdb/rag", slug: "rag" },
            { label: "@askdb/http-api", slug: "http-api" },
          ],
        },
        {
          label: "Contracts",
          items: [
            { label: "AskDB schema", slug: "askdb-schema" },
            { label: "Connectors", slug: "connectors" },
            { label: "Modes and safety", slug: "modes" },
            { label: "Environment", slug: "environment" },
          ],
        },
      ],
    }),
  ],
});
