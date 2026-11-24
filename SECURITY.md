# Security policy

## Reporting a problem

Please report security problems privately through [GitHub's private vulnerability reporting](https://github.com/chaotyc/internship-tracker/security/advisories/new) rather than in a public issue. Include the app version, your system and steps to reproduce. You'll get a reply as soon as possible, and a fix will be released before the details are made public.

If that link doesn't work for you, open an issue that only asks for a private way to get in touch, with no details of the problem.

## Supported versions

Security fixes go into the latest release only. The app doesn't update itself, so check the [Releases page](https://github.com/chaotyc/internship-tracker/releases) for new versions.

## How the app protects your data

- All data stays in the app's folder on your computer. There's no account, server or telemetry.
- The profile, saved answers, demographic answers, API keys and inbox password are encrypted with the operating system's keychain (Electron `safeStorage`) before they're written to disk. The board, notes, chats and the copy of your resume are not encrypted by the app; turn on your system's disk encryption to protect them.
- On Linux without a keyring, Electron can only fall back to a fixed, built-in password, so the app treats that as no encryption. It then keeps your contact details, education and preferences unencrypted, and doesn't store saved answers, demographic answers, API keys or an inbox password at all.
- The app's own window runs with context isolation and the sandbox on, no Node.js access, and a strict Content Security Policy. Only the app's own pages can call into the main process or receive its events, and only on a fixed list of channels.
- Links open in your browser, not inside the app.
- Autofill opens postings in a separate, sandboxed window with no access to the app, in its own browser session. Sites in that window are denied every permission (camera, location, notifications, clipboard). Cookies and sign-ins from job sites stay in that session so you don't sign in each time. Autofill never submits a form.
- With a command-line AI connection, the app runs that tool in a new temporary folder with file and shell tools turned off (Claude Code), in a read-only sandbox (Codex), or with its default approval mode (Gemini CLI). The tool's own sign-in and settings apply.
- The JSON export leaves out API keys and the inbox password, but includes your profile and saved answers unencrypted.
