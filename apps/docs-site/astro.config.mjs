import { fileURLToPath } from "node:url";
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

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

/** Starlight does not export `user-components/Icon.astro` in package.json `exports`. */
const starlightIcon = fileURLToPath(
  new URL("node_modules/@astrojs/starlight/user-components/Icon.astro", import.meta.url)
);

export default defineConfig({
  site: `${site}${normalizedBase}`,
  base,
  markdown: {
    remarkPlugins: [remarkRebaseLinks],
  },
  vite: {
    resolve: {
      alias: {
        "@starlight/icon": starlightIcon,
      },
    },
  },
  integrations: [
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
      sidebar: [
        {
          label: "Start",
          items: [
            { label: "Overview", slug: "index" },
            { label: "Quickstart", slug: "quickstart" },
            { label: "Install", slug: "install" },
            { label: "Studio", slug: "studio" },
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
            { label: "Troubleshooting", slug: "getting-started/troubleshooting" },
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
            { label: "ask() options", slug: "reference/ask-options" },
          ],
        },
      ],
    }),
  ],
});
