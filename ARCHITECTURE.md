# Architecture

```
src/
  shared/        Types and pure helpers used by both processes. No Node or DOM imports.
    roles.ts profile.ts ai.ts search.ts chat.ts autofill.ts today.ts   one file per feature
    ipc.ts       Combines every feature's channel map into IpcChannels / IpcEvents
    order.ts     Card ordering helper
  main/          Electron main process
    index.ts     Boot: single-instance lock, open the store, run migrations, register features, open the window
    context.ts   FeatureContext and Services handed to every feature
    db/store.ts  sql.js wrapper: all/get/run/tx/migrate, atomic debounced writes
    ipc.ts       handle(channel, fn) and emit(event, payload), fully typed; only the app's own pages may call in
    secrets.ts   OS-keychain encryption (safeStorage) for keys and sensitive fields
    settings.ts  Plain JSON settings
    headless.ts  Off-screen rendering for screenshots and automated checks
    demo.ts      Sample board for TRACKER_DEMO=1 (throwaway database)
    features/<name>/index.ts   One folder per feature; exports `feature: Feature`
  preload/       Exposes window.api.invoke / window.api.on to the renderer
  renderer/src/  React UI
    App.tsx      Shell: top bar, Board / Today views, side panel, dialogs
    components/  Dialog, Toast, Icon, DateField, Switch
    lib/         IPC hooks (api.ts) and date/label formatting (format.ts)
    features/<name>/   UI for each feature
    styles/tokens.css  Design tokens (light and dark). Use tokens, never raw colors.
build/           App icon (icon.svg is the source; `npm run icon` renders icon.png)
scripts/         snapshot.mjs (off-screen screenshots), icon.mjs
```

Features: `roles` (board), `profile` (profile, tracks, resumes, export), `ai` (CLI and API providers), `search` (add from link, Find roles, recheck, job boards), `chat` (assistant), `autofill` (Greenhouse, Ashby, Lever), `today` (next steps, email updates, IMAP).

## Security model

- Renderer windows run with `contextIsolation`, `sandbox` and no Node integration, under a strict Content Security Policy.
- `src/main/ipc.ts` rejects calls from any page that isn't the app's own, and only sends events to app pages.
- The autofill window loads third-party sites in its own session partition, without the preload.
- Secrets go through `secrets.ts`; nothing sensitive is stored in plain settings.

## Rules for a feature

1. **Own your folder.** A feature lives in `src/main/features/<name>/`, `src/renderer/src/features/<name>/` and `src/shared/<name>.ts`. Touch other features' files only through their service interface.
2. **Contracts first.** Every renderer call is a channel in `src/shared/<name>.ts` (`XChannels`), and every push is an event (`XEvents`). The preload only forwards channels named `<feature>:<action>`.
3. **Register in `index.ts`.** `register(ctx)` calls `handle(...)` for each channel and, if other features need it, sets `ctx.services.<name>`.
4. **Migrations are per feature.** Export `migrations: [{ id: '<feature>-001', sql }]`. IDs are never reused or edited after merge.
5. **Talk to roles through `ctx.services.roles`**, which emits `roles:changed` so the board refreshes.
6. **AI goes through `ctx.services.ai`** (`complete`, `json`, `status`). Never call a provider directly from another feature.
7. **Nothing leaves the machine** except calls to the AI provider the user connected and public job-board/posting fetches. No telemetry.
8. **Never submit an application** on the user's behalf. Autofill stops before Submit.
9. **UI uses the tokens** in `styles/tokens.css` and the shared `.btn`, `.field`, `.chip` classes. Check both light and dark (`node scripts/snapshot.mjs`).
10. **Tests** live beside the code as `*.test.ts` and run under Node with vitest; mock `electron` where needed (see `features/roles/roles.test.ts`).
