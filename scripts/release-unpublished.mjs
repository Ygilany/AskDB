#!/usr/bin/env node
// Lists the public workspace packages whose current version isn't on npm yet, as a
// JSON array of `{ name, version }` on stdout. `release.yml` uses it to decide whether
// there is anything to publish and which git tags to create afterwards. A push to `main`
// without a merged Version PR has nothing to publish: `changesets.yml` keeps every other
// PR from adding an unpublished version, and `release.yml`'s `approved` job refuses to
// publish from any commit but a Version PR's merge, or anything that merge didn't add.
//
// Only a 404 from the registry counts as "not published". Any other `npm view`
// failure exits non-zero, so a registry outage can't read as "publish everything".
import { isPublished, publicPackages } from "./release-packages.mjs";

try {
  const unpublished = publicPackages()
    .filter((pkg) => !isPublished(pkg))
    .map(({ name, version }) => ({ name, version }));
  process.stdout.write(`${JSON.stringify(unpublished)}\n`);
} catch (error) {
  process.stderr.write(`release-unpublished: ${error.message}\n`);
  process.exit(1);
}
