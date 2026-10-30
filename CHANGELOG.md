# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/). Until 1.0, scores, thresholds and the
stored data format may change.

## [0.1.0] - 2026-10-30

First public, experimental release.

### Added
- Manifest V3 extension with four permissions (`management`, `storage`, `alarms`,
  `notifications`) and host access to the two Chrome Web Store update hosts only.
- Baselines of every installed Chrome Web Store extension, downloaded from the
  update server, with a check that the CRX3 `crx_id` matches and that the version
  matches what is installed (store-ahead and store-behind cases handled).
- Update detection through `management.onInstalled` plus a 1 to 24 hour poll.
- Diff engine (`src/lib/diff.js`) with explainable points (`src/lib/risk.js`):
  permissions (with or without Chrome warnings), host access, content-script sites,
  `MAIN` world, CSP, update URL, homepage, author, `externally_connectable`, static
  DNR rules that strip security headers, first use of risky code patterns, new sites
  in code (filter-list style data files excluded from scoring), obfuscated and
  WebAssembly files, ZIP tricks, unreadable code, size jumps.
- Fail-closed handling: an update whose package cannot be analysed is reported as
  high risk with the permission changes Chrome reports.
- Defensive ZIP reader: limits on entries and sizes, chunked inflate that stops at
  the declared size, duplicate, case-collision and overlapping entries reported.
- Popup with badge, report page (reasons ledger, access before/after, sites, code
  patterns, files, `manifest.json` diff), overview of all extensions and their
  status, settings (auto-disable, notifications, interval, ignore list, JSON export,
  delete all data).
- English and Arabic, with a right-to-left layout.
- Node scripts: `compare.mjs` (diff two packages), `noise.mjs` (routine-update check
  on real releases), `build.mjs` (reproducible store zip), screenshot and art
  renderers, and the experiment in `docs/experiment.md`.

[0.1.0]: https://github.com/yahyakhalid/crxdiff/releases/tag/v0.1.0
