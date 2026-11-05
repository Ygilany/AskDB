/**
 * The builds pnpm must approve to install `@askdb/prisma`, an optional peer (#259):
 * `@prisma/engines` has a postinstall script, and pnpm 11 exits 1 on an unapproved one.
 * Read by `askdb init`'s install plan and the introspect command's missing-package hint, so the two stay in step. Studio's copy is `apps/studio/src/prisma-install.ts`.
 */
export const PRISMA_BUILD_APPROVALS: readonly string[] = ["@prisma/engines"];
