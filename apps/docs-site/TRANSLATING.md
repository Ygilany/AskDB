# Translating the AskDB docs

The docs site is built with [Starlight](https://starlight.astro.build/), which
has first-class internationalization (i18n). English is the default language
and is served at the site root; every other language lives in a subfolder named
after its locale.

A **language switcher** appears automatically in the site header whenever more
than one locale is configured, so readers can move between languages on any
page.

## How translations are organized

Locales are declared in [`astro.config.mjs`](./astro.config.mjs):

```js
defaultLocale: "root",
locales: {
  root: { label: "English", lang: "en" },
  ar: { label: "العربية", lang: "ar", dir: "rtl" },
},
```

- English content lives directly under `src/content/docs/`.
- Each translated locale mirrors that tree under `src/content/docs/<locale>/`.
  Arabic lives under `src/content/docs/ar/`.

The file paths line up one-to-one. For example:

| English | Arabic |
| --- | --- |
| `src/content/docs/quickstart.mdx` | `src/content/docs/ar/quickstart.mdx` |
| `src/content/docs/guides/embed-in-node.mdx` | `src/content/docs/ar/guides/embed-in-node.mdx` |
| `src/content/docs/reference/cli.mdx` | `src/content/docs/ar/reference/cli.mdx` |

### Fallback for untranslated pages

You do **not** have to translate everything at once. If a page is missing for a
locale, Starlight automatically serves the English version in its place (with a
notice). This means you can contribute one page at a time, and partial
translations are always safe to merge.

## Contributing a translation

1. Find the English source under `src/content/docs/…`.
2. Copy it to the matching path under your locale folder (e.g. `…/ar/…`).
3. Translate the prose and keep the structure identical. Specifically:
   - **Frontmatter:** keep every key as-is. Translate only human-readable
     values such as `title`, `description`, and `tagline`. Leave `template`,
     `slug`, link targets, icons, and variants unchanged.
   - **Code, commands, and identifiers:** never translate fenced code blocks,
     inline code, CLI commands and flags, file paths, environment variable
     names, `@askdb/*` package names, or API field names.
   - **Internal links:** point links at the same locale so readers stay in
     their language — e.g. write `/ar/quickstart/` instead of `/quickstart/`.
     Leave external links, anchors (`#…`), and asset paths untouched.
   - **Relative imports:** a page under `ar/` sits one directory deeper than its
     English source, so any module-level relative import at the top of the file
     needs one extra `../`. For example `../../assets/x.svg` becomes
     `../../../assets/x.svg`. (Imports from `@astrojs/starlight/components` are
     package imports and never change. Imports inside code blocks are example
     code and must be left alone.)
4. Translate the matching sidebar labels in `astro.config.mjs` by adding your
   locale to the `translations` map on each entry, e.g.
   `translations: { ar: "البدء السريع" }`.
5. Run the build locally (see below) and open a pull request.

UI strings that Starlight itself renders — "On this page", "Search", the
previous/next links, and so on — are already translated for many languages
(including Arabic) and require no work.

## Adding a brand-new language

1. Add the locale to the `locales` map in `astro.config.mjs`. Set `lang` to the
   BCP-47 tag and add `dir: "rtl"` for right-to-left languages.
2. Add that locale's key to the `translations` maps on the sidebar entries.
3. Create `src/content/docs/<locale>/` and start translating pages. Until a page
   exists there, English is served as a fallback.

## Building and checking locally

```bash
pnpm --filter @askdb/docs-site dev      # local preview at http://127.0.0.1:4310
pnpm --filter @askdb/docs-site build    # production build
pnpm --filter @askdb/docs-site lint     # astro check (type/content validation)
```

## Known gaps

The marketing homepage (`index.mdx`) renders several shared Astro components
(the hero, workflow, engine grid, and privacy boundary). Their text currently
lives in the component source rather than in content, so it is not yet
localized — the Arabic homepage shows that text in English. Localizing those
components is a good follow-up contribution.
