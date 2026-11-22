# Contributing

Thanks for helping. Bug reports, fixes and small improvements are welcome. For anything larger, open an issue first so we can agree on the approach.

## Setup

```bash
npm install
TRACKER_DEMO=1 npm run dev   # sample board in a throwaway database
```

Use the demo board for screenshots and bug reports so no one's real applications end up in an issue.

## Before you open a pull request

```bash
npm run check   # type check and unit tests
```

- Follow the feature rules in [ARCHITECTURE.md](ARCHITECTURE.md): each feature owns its folder, renderer calls go through typed channels, and migrations are never edited after release.
- Use the design tokens in `src/renderer/src/styles/tokens.css` and check both light and dark themes. `node scripts/snapshot.mjs` renders every view off-screen into `./screenshots`.
- Add or update tests beside the code (`*.test.ts`).
- Keep commits focused, and describe what changed and why in the pull request.

## Ground rules for features

- Nothing leaves the user's computer except calls to the AI provider they connected and reads of public job-board pages, plus the inbox they connect themselves. No telemetry.
- The app never submits an application. Autofill stops before Submit.
- Anything the AI proposes is shown to the user and applied only when they confirm it.

## Releasing

1. Update `version` in `package.json` and add a section to `CHANGELOG.md`.
2. Commit, then tag and push: `git tag v1.2.3 && git push origin v1.2.3`.
3. The Release workflow builds the macOS, Windows and Linux installers and attaches them to a draft release. Review the draft and publish it.
