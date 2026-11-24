# Architecture

```
src/
  shared/        Types and pure helpers used by both processes. No Node or DOM imports.
    roles.ts profile.ts ai.ts search.ts chat.ts autofill.ts today.ts onboarding.ts   one file per feature
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
    smoke.ts     Smoke check for packaged builds (TRACKER_SMOKE=1): waits for a view, reports, exits
    demo.ts      Sample board for TRACKER_DEMO=1 (throwaway database)
    features/index.ts          The list of features, in registration order
    features/<name>/index.ts   One folder per feature; exports a `Feature` (for example `rolesFeature`)
  preload/       Exposes window.api.invoke / window.api.on to the renderer
  renderer/src/  React UI
    App.tsx      Shell: top bar, Board / Today views, side panel, dialogs, the welcome tour
    components/  Dialog, Toast, Icon, DateField, Switch
    lib/         IPC hooks (api.ts) and date/label formatting (format.ts)
    features/<name>/   UI for each feature
    styles/tokens.css  Design tokens (light and dark). Use tokens, never raw colors.
build/           App icon (icon.svg is the source; `npm run icon` renders icon.png)
scripts/         snapshot.mjs (off-screen screenshots of a dev build), smoke.mjs (packaged-build smoke test), icon.mjs
```

Features: `roles` (board), `profile` (profile, tracks, resumes, export), `ai` (CLI and API providers), `search` (add from link, Find roles, recheck, job boards), `chat` (assistant), `autofill` (Greenhouse, Ashby, Lever), `today` (next steps, email updates, IMAP), `onboarding` (first-run welcome tour: whether it has been seen, stored in settings as `onboarding.state`).

### How Find roles decides

`search/autosearch.ts` runs one scan: read every enabled source, filter, shortlist, rank, report.

1. **Filter** (`search/filter.ts`, no AI). Each posting gets one skip reason or passes: role type (internship, new grad, full-time), term named in the title, place (locations that name no city are kept), words to skip (title, department and the requirements section), degree level (`search/eligibility.ts`, which reads the full description and only rules a posting out when every degree requirement is above the applicant's), and keywords (plurals and synonyms count). Postings with no description yet skip the keyword rule until they're read.
2. **Shortlist.** The top 40 by keyword score go on; the rest are reported as `shortlist`.
3. **Rank** (`search/rank.ts`). One AI call scores the shortlist per track and can mark a posting `eligible: false`, which moves it to the report.
4. **Report.** Counts per reason and up to 150 postings per reason are saved in settings as `search.lastReport`, shown by **View skipped**.

`search/recall.test.ts` runs the filter over real postings in `search/fixtures/recall-postings.json` with the decision a person would make for two applicants. Change the filter, run it, and fix the filter (not the labels) if it starts dropping roles that fit.

## Security model

- Renderer windows run with `contextIsolation`, `sandbox` and no Node integration, under a strict Content Security Policy.
- `src/main/ipc.ts` rejects calls from any page that isn't the app's own, and only sends events to app pages.
- The autofill window loads third-party sites in its own session partition, without the preload.
- Secrets go through `secrets.ts`; nothing sensitive is stored in plain settings. Without a usable keychain (Linux with no keyring, where Electron's `basic_text` fallback counts as none), the profile keeps only its non-sensitive parts in settings and drops saved and demographic answers (`profile/service.ts`).

## Rules for a feature

1. **Own your folder.** A feature lives in `src/main/features/<name>/`, `src/renderer/src/features/<name>/` and `src/shared/<name>.ts`. Touch other features' files only through their service interface.
2. **Contracts first.** Every renderer call is a channel in `src/shared/<name>.ts` (`XChannels`), and every push is an event (`XEvents`). The preload only forwards channels named `<feature>:<action>`, and only for the feature names listed in `src/preload/index.ts`; add a new feature there.
3. **Register in `index.ts`.** Add the feature to `src/main/features/index.ts`. Its `register(ctx)` calls `handle(...)` for each channel and, if other features need it, sets `ctx.services.<name>`.
4. **Migrations are per feature.** Export `migrations: [{ id: '<feature>-001', sql }]`. IDs are never reused or edited after merge.
5. **Talk to roles through `ctx.services.roles`**, which emits `roles:changed` so the board refreshes.
6. **AI goes through `ctx.services.ai`** (`complete`, `json`, `status`). Never call a provider directly from another feature.
7. **Nothing leaves the machine** except calls to the AI provider the user connected and public job-board/posting fetches. No telemetry.
8. **Never submit an application** on the user's behalf. Autofill stops before Submit.
9. **UI uses the tokens** in `styles/tokens.css` and the shared `.btn`, `.field`, `.chip` classes. Check both light and dark (`node scripts/snapshot.mjs`).
10. **Tests** live beside the code as `*.test.ts` and run under Node with vitest; mock `electron` where needed (see `features/roles/roles.test.ts`).
