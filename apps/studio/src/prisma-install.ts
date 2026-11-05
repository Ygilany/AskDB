/**
 * The builds pnpm must approve to install `@askdb/prisma`, an optional peer (#259):
 * `@prisma/engines` has a postinstall script, and pnpm 11 exits 1 on an unapproved one.
 * Read by guided setup's install plan and the introspection plan's missing-package hint, so the two stay in step. `askdb init`'s copy is `apps/cli/src/prisma-install.ts`.
 */
export const PRISMA_BUILD_APPROVALS: readonly string[] = ["@prisma/engines"];
