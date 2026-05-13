---
"@askdb/studio": minor
---

Refactor the monolithic `apps/studio/src/web/App.tsx` (~1373 lines) into a thin shell (~120 lines) plus feature-folder modules. The studio web app is now organized around three custom hooks — `useWorkspace`, `useRag`, `useAsk` — and dedicated `features/{workspace,rag,ask,settings,inspector}` components. Shared UI primitives moved under `components/common/`, and pure helpers live in `lib/{drafts,format}.ts`. Pure structural refactor: same DOM, same class names, same API calls, same loading/error screens.
