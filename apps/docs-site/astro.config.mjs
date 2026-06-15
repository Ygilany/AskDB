import { fileURLToPath } from "node:url";
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

const base = process.env.ASTRO_BASE ?? "/";
const normalizedBase = base === "/" ? "" : base.replace(/\/$/, "");

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
  site: `https://ygilany.github.io${normalizedBase}`,
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
        Footer: "./src/components/overrides/Footer.astro",
      },
      editLink: {
        baseUrl: "https://github.com/Ygilany/AskDB/edit/main/apps/docs-site/",
      },
      // English is the default (served at the site root); Arabic is served under
      // `/ar/` and rendered right-to-left. Configuring more than one locale makes
      // Starlight render the language switcher in the site header automatically,
      // and any page that has not been translated yet transparently falls back to
      // its English source — so contributors can translate pages incrementally.
      defaultLocale: "root",
      locales: {
        root: { label: "English", lang: "en" },
        ar: { label: "العربية", lang: "ar", dir: "rtl" },
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
          translations: { ar: "ابدأ" },
          items: [
            { label: "Overview", translations: { ar: "نظرة عامة" }, slug: "index" },
            { label: "Quickstart", translations: { ar: "البدء السريع" }, slug: "quickstart" },
            { label: "Studio", translations: { ar: "الاستوديو" }, slug: "studio" },
          ],
        },
        {
          label: "Guides",
          translations: { ar: "الأدلة" },
          items: [
            { label: "Embed in a Node app", translations: { ar: "الدمج في تطبيق Node" }, slug: "guides/embed-in-node" },
            { label: "Author your schema", translations: { ar: "تأليف مخطّطك" }, slug: "guides/author-your-schema" },
            { label: "Run safely in production", translations: { ar: "التشغيل بأمان في الإنتاج" }, slug: "guides/run-safely-in-prod" },
            { label: "Deploy as HTTP service", translations: { ar: "النشر كخدمة HTTP" }, slug: "guides/deploy-as-http-service" },
            { label: "Multi-tenancy", translations: { ar: "تعدّد المستأجرين" }, slug: "guides/multi-tenancy" },
            { label: "Switch engines", translations: { ar: "تبديل المحرّكات" }, slug: "guides/switch-engines" },
            { label: "Bring your own model", translations: { ar: "استخدم نموذجك الخاص" }, slug: "guides/bring-your-own-model" },
            { label: "RAG for large schemas", translations: { ar: "RAG للمخطّطات الكبيرة" }, slug: "guides/rag-for-large-schemas" },
            {
              label: "Integrations",
              translations: { ar: "التكاملات" },
              items: [
                { label: "Prisma", translations: { ar: "Prisma" }, slug: "guides/integrations/prisma" },
                { label: "Agents & MCP", translations: { ar: "الوكلاء وMCP" }, slug: "guides/integrations/agents-mcp" },
              ],
            },
          ],
        },
        {
          label: "Concepts",
          translations: { ar: "المفاهيم" },
          items: [
            { label: "How AskDB works", translations: { ar: "كيف يعمل AskDB" }, slug: "concepts/how-askdb-works" },
            { label: "The schema artifact", translations: { ar: "مُصنَّع المخطّط" }, slug: "concepts/the-schema-artifact" },
            { label: "Safety boundaries", translations: { ar: "حدود الأمان" }, slug: "concepts/safety-boundaries" },
            { label: "Modes and dialects", translations: { ar: "الأوضاع واللهجات" }, slug: "concepts/modes-and-dialects" },
            { label: "Privacy model", translations: { ar: "نموذج الخصوصية" }, slug: "concepts/privacy-model" },
          ],
        },
        {
          label: "Reference",
          translations: { ar: "المرجع" },
          items: [
            { label: "CLI", translations: { ar: "سطر الأوامر (CLI)" }, slug: "reference/cli" },
            { label: "HTTP API", translations: { ar: "واجهة HTTP" }, slug: "reference/http-api" },
            { label: "Configuration", translations: { ar: "الإعدادات" }, slug: "reference/config" },
            { label: "Packages", translations: { ar: "الحزم" }, slug: "reference/packages" },
          ],
        },
      ],
    }),
  ],
});
