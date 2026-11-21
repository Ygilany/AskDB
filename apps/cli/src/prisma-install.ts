/**
 * The builds pnpm must approve to install `@askdb/prisma`, an optional peer (#259):
 * `@prisma/engines` has a postinstall script, and pnpm 11 exits 1 on an unapproved one.
 * Read by the introspect command's missing-package hint. `askdb init` installs from the scaffold planner in `@askdb/config/scaffold`, which approves the same build (`init.test.ts` checks they match). Studio's copy is `apps/studio/src/prisma-install.ts`.
 */
export const PRISMA_BUILD_APPROVALS: readonly string[] = ["@prisma/engines"];

// Keep these host dependency ranges in sync with the Prisma scaffold in @askdb/config.
export const PRISMA_YARN_PNP_HINT =
  "For Yarn Plug'n'Play, install the host dependencies too: \`yarn add @askdb/prisma \"ai@^7.0.51\" \"zod@^4.6.7\"\`.";
