/**
 * The builds pnpm must approve to install `@askdb/prisma`, an optional peer (#259):
 * `@prisma/engines` has a postinstall script, and pnpm 11 exits 1 on an unapproved one.
 * Read by the introspect command's missing-package hint. `askdb init` installs from the scaffold planner in `@askdb/config/scaffold`, which approves the same build. Studio's copy is `apps/studio/src/prisma-install.ts`.
 */
export const PRISMA_BUILD_APPROVALS: readonly string[] = ["@prisma/engines"];
