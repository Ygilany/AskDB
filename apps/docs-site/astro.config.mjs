import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

const base = process.env.ASTRO_BASE ?? "/";
const normalizedBase = base === "/" ? "" : base.replace(/\/$/, "");

export default defineConfig({
  site: `https://ygilany.github.io${normalizedBase}`,
  base,
  integrations: [
    starlight({
      title: "AskDB",
      description:
        "Documentation for AskDB packages, CLI tools, schema artifacts, and HTTP API.",
      logo: {
        light: "./src/assets/brand/logo.png",
        dark: "./src/assets/brand/logo-dark.png",
        alt: "AskDB",
        replacesTitle: true,
      },
      favicon: "/favicon-light.png",
      customCss: ["./src/styles/custom.css"],
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
            { label: "Core concepts", slug: "concepts" },
            { label: "Architecture", slug: "architecture" },
          ],
        },
        {
          label: "Packages",
          items: [
            { label: "Package index", slug: "packages" },
            { label: "@askdb/core", slug: "core" },
            { label: "@askdb/postgres", slug: "postgres" },
            { label: "@askdb/cli", slug: "cli" },
            { label: "@askdb/introspect", slug: "introspect" },
            { label: "@askdb/enrich", slug: "enrich" },
            { label: "@askdb/tui", slug: "tui" },
            { label: "@askdb/rag", slug: "rag" },
            { label: "@askdb/http-api", slug: "http-api" },
          ],
        },
        {
          label: "Contracts",
          items: [
            { label: "Schema v2", slug: "schema-v2" },
            { label: "Connectors", slug: "connectors" },
            { label: "Modes and safety", slug: "modes" },
            { label: "Environment", slug: "environment" },
          ],
        },
      ],
    }),
  ],
});
