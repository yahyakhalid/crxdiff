# Security policy

crxdiff downloads and unpacks the packages of other extensions, and the people who
publish those packages may be hostile. Bugs that let a crafted package crash a
check, hide a change, slow the browser, fill storage, or put content into crxdiff's
pages as anything other than text are security bugs. Reports of that kind are
especially welcome.

## How crxdiff is scoped

- **Permissions:** `management`, `storage`, `alarms`, `notifications`, and host
  access to `https://clients2.google.com/*` and `https://clients2.googleusercontent.com/*`
  only. No content scripts, no `<all_urls>`, no `externally_connectable`, no
  `web_accessible_resources`.
- **CSP:** `default-src 'none'`, `script-src 'self'`, `object-src 'none'`, and
  `connect-src` limited to the two update hosts.
- **No remote code, no `eval`.** Package content is never executed or injected. It is
  shown only through `textContent` (see `src/shared/ui.js`), and ESLint forbids
  `innerHTML`, `outerHTML`, `insertAdjacentHTML` and `document.write`.
- **Limits on untrusted input** (`src/lib/zip.js`, `src/lib/snapshot.js`): at most
  20,000 entries, 64 MB per file, 768 MB declared in total, a compression-ratio
  check, inflation in 8 KB steps that stops at the declared size, a 90-second
  analysis budget, a 100 MB download cap with a 2-minute timeout, and a 2 MB cap on
  what is stored per extension. Text scanners are linear-time (see the
  adversarial-input test in `test/scan.test.js`).
- **Fail closed:** an update that cannot be analysed is reported as high risk.

An independent review of these areas was done before 0.1.0; its findings and the
regression tests for them are in `test/review-regressions.test.js`.

## Supported versions

Only the latest 0.x release receives fixes.

## Reporting a vulnerability

Please do **not** open a public issue. Use GitHub's private reporting:
[Report a vulnerability](https://github.com/yahyakhalid/crxdiff/security/advisories/new).

Include the package (or a script that builds it), what crxdiff did, and what you
expected. You should get a reply within 7 days. This is a volunteer project with one
maintainer, so fixes are best effort.

If crxdiff helped you find a malicious extension, report it to Google with the
"Report abuse" link on its Chrome Web Store page.
