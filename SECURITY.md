# Security policy

## Reporting a problem

Please report security problems privately through [GitHub's private vulnerability reporting](https://github.com/chaotyc/internship-tracker/security/advisories/new) rather than in a public issue. Include the app version, your system and steps to reproduce. You'll get a reply as soon as possible, and a fix will be released before the details are made public.

## Supported versions

Security fixes go into the latest release.

## How the app protects your data

- All data stays in the app's folder on your computer. There's no server or telemetry.
- The profile, saved answers, demographic answers, API keys and inbox password are encrypted with the operating system's keychain (Electron `safeStorage`) before they're written to disk.
- The interface runs with context isolation and the sandbox on, and with no Node.js access. The app's own pages are the only ones that can call into the main process.
- Links open in your browser, not inside the app.
- Autofill opens postings in a separate, sandboxed window with its own session, and never submits a form.
