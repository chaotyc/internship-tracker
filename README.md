# Internship Tracker

A local-first desktop app for tracking internship and job applications. Drag roles across a board from **Saved** to **Offer**, let an assistant find roles that fit you, check whether saved postings have closed, and fill in Greenhouse applications from your profile.

Everything is stored on your computer. Nothing is sent anywhere unless you use an AI feature, and then it goes only to the AI provider you connected.

## Features

| | |
| --- | --- |
| **Board** | Six stages (Saved, Applied, Interviewing, Offer, Rejected, Closed). Drag cards between them, or use <kbd>Shift</kbd>+<kbd>←</kbd>/<kbd>→</kbd>. Import any CSV with Company and Role columns. |
| **Add from a link** | Paste a posting link; the app reads the posting and fills in company, role, location, pay and deadline. |
| **AI connections** | Uses your existing Claude Code, Codex or Gemini CLI sign-in, or an API key you paste in (stored in the OS keychain). |
| **Autosearch** | Scans the public job boards of companies you choose (Greenhouse, Ashby, Lever) and ranks new postings against your profile. |
| **Refresh** | Checks every saved role and flags postings that have closed or are about to. |
| **Assistant** | A chat sidebar that knows your resume, preferences and board. It can add roles, update your preferences and draft application answers, always with your confirmation. |
| **Autofill** | Opens a Greenhouse application in its own window and fills it from your profile. It never submits; you review and click Submit. |
| **Private profile** | Name, contact details, education, work authorization and optional demographic answers, encrypted at rest with the OS keychain. |

## Run it

Requires Node 22+ and macOS, Windows or Linux.

```bash
npm install
npm run dev          # app with hot reload
npm test             # unit tests
npm run typecheck
TRACKER_DEMO=1 npm run dev   # sample board in a throwaway database
node scripts/snapshot.mjs    # screenshots of each view into ./screenshots
```

Data lives in the app's user-data folder (`~/Library/Application Support/internship-tracker` on macOS) in `tracker.sqlite`.

## How it's built

Electron + React + TypeScript, bundled with electron-vite. Storage is SQLite via sql.js (WebAssembly, no native modules). See [ARCHITECTURE.md](ARCHITECTURE.md).

## License

MIT
