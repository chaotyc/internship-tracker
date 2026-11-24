# Changelog

All notable changes to this project are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-11-24

First public release.

### Added

- **Board** with Saved, Applied, Interviewing and Offer stages, collapsible Rejected and Closed lanes, drag and drop, keyboard moves and CSV import.
- **Today** view of overdue, due today, this week and later next steps and posting deadlines, with done, snooze and undo.
- **Email updates** from pasted text, dropped `.eml` files or a read-only IMAP inbox (Gmail, iCloud, Fastmail or any IMAP server). Updates are proposals you review and apply.
- **Application tracks**: a resume, target roles and answer overrides per kind of role.
- **Add from a link** for Greenhouse, Ashby, Lever, Workday and other postings.
- **Find roles** across watched Greenhouse, Ashby, Lever and Workday boards and, optionally, the SimplifyJobs internship and new grad lists. Choose internships, new grad and entry-level roles, or any full-time role. It skips postings in other places or terms, ones that mention words you skip (in the title, department or requirements) and ones limited to a higher degree than yours, then ranks the rest per track. Keywords match plurals and common synonyms ("compiler" finds "compilers", "ML" finds "machine learning"). An optional daily scan runs while the app is open.
- **Degree level**, taken from your education or set by hand. Find roles quotes the requirement when it skips a posting, and keeps ones open to several levels, such as "BS, MS or PhD students". With AI connected, ranking can also rule out roles you can't apply to.
- **View skipped**: every posting the last Find roles run left out, grouped by reason, with **Add to Saved** on each. Open it from the suggestions tray, the Find roles result or **Settings → Job boards**.
- **Recheck postings** to flag closed or closing saved roles.
- **Assistant** sidebar that proposes board and profile changes, including role types and degree level, for you to confirm.
- **Autofill** for Greenhouse, Ashby and Lever applications. It never submits.
- **AI connections** through Claude Code, Codex or Gemini CLI sign-ins, or Anthropic, OpenAI and Gemini API keys, with a connection test.
- **Welcome tour** on first launch: connect AI, add a resume and contact details, add your first roles, and a short tour of the app. Every step can be skipped. It opens once; reopen it from **Settings → Show welcome tour**.
- Encrypted local profile, JSON export and erase-everything.
- The app's own menu, with **Help** links to the project, problem reports and new versions, and the app version at the bottom of **Settings**.
- Installers for macOS (Apple Silicon and Intel), Windows and Linux (`.deb` and AppImage), smoke-tested on all three in CI. The builds aren't code-signed yet.

[0.1.0]: https://github.com/chaotyc/internship-tracker/releases/tag/v0.1.0
