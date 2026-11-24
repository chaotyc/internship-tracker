# Contributing

Thanks for helping. Bug reports, fixes and small improvements are welcome. For anything larger, open an issue first so we can agree on the approach.

## Setup

Requires Node.js 22 or later.

```bash
npm install
TRACKER_DEMO=1 npm run dev   # sample board in a throwaway database
```

Use the demo board for screenshots and bug reports so no one's real applications end up in an issue.

Without `TRACKER_DEMO=1`, `npm run dev` opens the same data folder as the installed app, so it works on your real board. It also won't start while the installed app is open, because only one copy may use that folder at a time.

## Before you open a pull request

```bash
npm run check   # type check and unit tests
```

- Follow the feature rules in [ARCHITECTURE.md](ARCHITECTURE.md): each feature owns its folder, renderer calls go through typed channels, and migrations are never edited after release.
- Use the design tokens in `src/renderer/src/styles/tokens.css` and check both light and dark themes. `THEME=both node scripts/snapshot.mjs` renders the main views off-screen with the demo board into `./screenshots`; the comment at the top of the script lists every view.
- Add or update tests beside the code (`*.test.ts`).
- Keep commits focused, and describe what changed and why in the pull request.

## Ground rules for features

- Nothing leaves the user's computer except calls to the AI provider they connected and reads of public job-board pages, plus the inbox they connect themselves. No telemetry.
- The app never submits an application. Autofill stops before Submit.
- Anything the AI proposes is shown to the user and applied only when they confirm it.

## Releasing

The Release workflow (`.github/workflows/release.yml`) runs when a tag starting with `v` is pushed. It runs the same checks and smoke tests as CI, stops if the tag doesn't match the version in `package.json`, creates one draft GitHub release for the tag, then builds on macOS, Windows and Linux and uploads the installers to it.

1. Set the version without creating a tag yet: `npm version 1.2.3 --no-git-tag-version`. This updates `package.json` and `package-lock.json`.
2. In `CHANGELOG.md`, rename `## [Unreleased]` to `## [1.2.3] - YYYY-MM-DD` with today's date, and update the links at the bottom.
3. Commit and push to `main`, and wait for CI to pass.
4. Tag the release commit and push the tag: `git tag v1.2.3 && git push origin v1.2.3`.
5. When the workflow finishes, open the draft and check that it has the `.dmg` and `.zip` for both Mac chips, the Windows `.exe`, and the Linux `.deb` and `.AppImage`. electron-builder also adds `latest*.yml` and `.blockmap` files; the app doesn't update itself, so they aren't needed. Paste the changelog section into the release notes, then publish it.
6. Add a new, empty `## [Unreleased]` section to the top of `CHANGELOG.md` for the next changes.

If a build fails after the tag is pushed, fix it on `main`, delete the draft and the tag (`git push --delete origin v1.2.3 && git tag -d v1.2.3`), and push the tag again (step 4).

