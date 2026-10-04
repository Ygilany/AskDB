---
---

docs(quickstart): make Prisma introspection tab config-first

- Rewrite the "Prisma schema file" tab to lead with the `askdb.config.ts` snippet (`introspection.provider` + `providerConfig.prisma.schemaPath`) and a bare `npx askdb introspect`
- Demote `--engine prisma --prisma-schema` to a one-off override (using `./other/schema.prisma` so it visibly differs from the configured path)
- Tab now mirrors the "Live database" tab's config-first → flag-as-override structure; removes the "You can also set this in config" afterthought sentence
