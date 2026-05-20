import { fileURLToPath } from "node:url";
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

const base = process.env.ASTRO_BASE ?? "/";
const normalizedBase = base === "/" ? "" : base.replace(/\/$/, "");

const withBase = (path) => (normalizedBase ? `${normalizedBase}${path}` : path);

const legacyRedirects = {
  "/schema-v2/": "/concepts/the-schema-artifact/",
  "/journeys/": "/concepts/how-askdb-works/",
  "/concepts/": "/concepts/how-askdb-works/",
  "/architecture/": "/concepts/how-askdb-works/",
  "/askdb-schema/": "/concepts/the-schema-artifact/",
  "/modes/": "/concepts/safety-boundaries/",
  "/connectors/": "/reference/packages/",
  "/multi-tenancy/": "/guides/multi-tenancy/",
  "/guides/embed-in-app/": "/guides/embed-in-node/",
  "/guides/author-enrich-schema/": "/guides/author-your-schema/",
  "/guides/rag-large-schema/": "/guides/rag-for-large-schemas/",
  "/guides/pgvector-setup/": "/guides/rag-for-large-schemas/",
  "/guides/http-api/": "/guides/deploy-as-http-service/",
  "/guides/agents-and-mcp/": "/guides/integrations/agents-mcp/",
  "/packages/": "/reference/packages/",
  "/environment/": "/reference/config/",
  "/core/": "/reference/packages/",
  "/postgres/": "/reference/packages/",
  "/prisma/": "/guides/integrations/prisma/",
  "/engines/": "/reference/packages/",
  "/cli/": "/reference/cli/",
  "/introspect/": "/reference/packages/",
  "/enrich/": "/reference/packages/",
  "/tui/": "/guides/author-your-schema/",
  "/studio/": "/guides/author-your-schema/",
  "/rag/": "/guides/rag-for-large-schemas/",
  "/http-api/": "/reference/http-api/",
};

const redirects = Object.fromEntries(
  Object.entries(legacyRedirects).map(([from, to]) => [withBase(from), withBase(to)])
);

/** Starlight does not export `user-components/Icon.astro` in package.json `exports`. */
const starlightIcon = fileURLToPath(
  new URL("node_modules/@astrojs/starlight/user-components/Icon.astro", import.meta.url)
);

export default defineConfig({
  site: `https://ygilany.github.io${normalizedBase}`,
  base,
  redirects,
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
        "The open-source Text-to-SQL toolkit your data team trusts. Ask your data. Keep control.",
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
            { label: "Install", slug: "install" },
          ],
        },
        {
          label: "Guides",
          items: [
            { label: "Embed in a Node app", slug: "guides/embed-in-node" },
            { label: "Author your schema", slug: "guides/author-your-schema" },
            { label: "Run safely in production", slug: "guides/run-safely-in-prod" },
            { label: "Deploy as HTTP service", slug: "guides/deploy-as-http-service" },
            { label: "Multi-tenancy", slug: "guides/multi-tenancy" },
            { label: "Switch engines", slug: "guides/switch-engines" },
            { label: "Bring your own model", slug: "guides/bring-your-own-model" },
            { label: "RAG for large schemas", slug: "guides/rag-for-large-schemas" },
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
          ],
        },
        {
          label: "Reference",
          items: [
            { label: "CLI", slug: "reference/cli" },
            { label: "HTTP API", slug: "reference/http-api" },
            { label: "Configuration", slug: "reference/config" },
            { label: "Packages", slug: "reference/packages" },
          ],
        },
      ],
    }),
  ],
});
