---
---

docs(site): add Arabic translation and a language switcher

- Configure Starlight i18n with English (default) and Arabic (`ar`, RTL); the
  language switcher now renders automatically in the site header, and any page
  missing a translation falls back to English so locales can grow incrementally
- Add an Arabic translation of every docs page under `src/content/docs/ar/`,
  with internal links pointed at the `/ar` locale and relative imports/image
  paths corrected for the deeper directory
- Translate the sidebar group and item labels via Starlight's per-entry
  `translations` map
- Add `TRANSLATING.md` documenting how contributors add and improve translations
  and how to onboard a brand-new language
