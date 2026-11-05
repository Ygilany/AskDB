---
"askdb": minor
"@askdb/studio": minor
"@askdb/prisma": patch
---

`@askdb/prisma` is now an optional peer of `askdb` and `@askdb/studio`, not a dependency. `pnpm add askdb` no longer installs Prisma, so it exits 0 on pnpm 11, which refused to run the unapproved `@prisma/engines` install script and exited 1 (#259). The CLI and Studio import `@askdb/prisma` only for Prisma introspection (#339), so `askdb --help` and every other command load no Prisma module.

**Breaking** for Prisma users: install `@askdb/prisma` next to `askdb` (`npm i @askdb/prisma`). On pnpm 11, approve its `@prisma/engines` build in the same command, `pnpm add --allow-build=@prisma/engines @askdb/prisma`, or run `pnpm approve-builds` afterwards. Without the package, `askdb introspect --engine prisma` exits 1 naming it, and Studio shows the same message instead of resyncing. `askdb` looks for `@askdb/prisma` in its own install, then in the project it runs in, so `npx askdb introspect` uses the project's copy.

`askdb init --database prisma` and Studio's guided setup now install `@askdb/prisma` at the version of the `askdb` or Studio running them, and with pnpm they approve the `@prisma/engines` build. `@askdb/prisma`'s README says to install it next to `askdb`.
