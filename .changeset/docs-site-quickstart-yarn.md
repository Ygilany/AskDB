---
"@askdb/docs-site": patch
---

The Quickstart has pnpm and Yarn tabs again (#713). The fixes they were waiting on shipped: Yarn Plug'n'Play (#748) in beta.48, and pnpm detection in a new project (#750) and the Windows install (#668) in beta.49. Each step that runs a package-manager command now shows npm, pnpm and Yarn. The Yarn tab sets up the project with `yarn init -2` and explains the `YN0004` build-script warning `askdb init` prints. The page says how to get pnpm or Yarn through Corepack (on Node 25 and newer, install Corepack first), and the Windows caution is gone. A note in step 2 says that pnpm and Yarn install only releases at least a day old, and gives the command that lets each install AskDB's newest release.
