---
"@askdb/docs-site": patch
---

The Quickstart has a Yarn tab again (#713). The Yarn Plug'n'Play crash it was waiting on (#748) is fixed in beta.48, and each step that runs a package-manager command now shows npm and Yarn. The Yarn tab sets up the project with `yarn init -2`, says how to get Yarn 4 through Corepack (on Node 25 and newer, install Corepack first), and explains the `YN0004` build-script warning `askdb init` prints. The Windows caution no longer says the printed install command is npm's. pnpm still waits on #750.
