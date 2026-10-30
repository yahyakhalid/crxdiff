# Experiment: can a plain MV3 extension do this at all?

Before building the UI, the three riskiest assumptions behind crxdiff were tested
in a real browser. Success criteria were written down **before** running anything;
results were filled in afterwards and are kept even where they were disappointing.

- Date: 2026-10-30
- Machine: Windows 11, Node 26, Chrome for Testing (stable channel, downloaded with
  `npx @puppeteer/browsers install chrome@stable`). Branded Chrome 137+ ignores
  `--load-extension`, so it was not used for extension tests.
- Scripts: `scripts/experiment/` (Node prototype and the in-browser runner).

## Hypothesis 1: an MV3 service worker can download and unpack any Web Store package

> With `host_permissions` for `https://clients2.google.com/*` and
> `https://clients2.googleusercontent.com/*` only, a service worker can `fetch`
> `https://clients2.google.com/service/update2/crx?response=redirect&prodversion=<v>&acceptformat=crx2,crx3&x=id%3D<ID>%26installsource%3Dondemand%26uc`,
> follow the redirect without a CORS error, parse the CRX3 header and unzip the
> package with vendored `fflate`, without remote code.

Success criteria (all must hold):

1. In Node: the download returns a file starting with `Cr24`, version 3, for at
   least 3 real extension IDs, and the parsed `manifest.json` has a `version`.
2. In a real extension service worker (unpacked, loaded in Chrome for Testing,
   with only the two host permissions above): the same download succeeds for the
   same IDs, the redirect to `clients2.googleusercontent.com` is followed, the
   `crx_id` inside the signed CRX3 header equals the requested ID, and the file
   list and manifest version match what Node got.
3. No `fetch` to any other host is needed.

## Hypothesis 2: the extension can find out when *another* extension updates

> `chrome.management.onInstalled` fires when another installed extension is
> updated (not only on fresh installs), so an update can be caught right away;
> a `chrome.alarms` poll comparing `management.getAll()` versions catches the rest.

Success criteria:

1. With crxdiff loaded, a second test extension is loaded at version 1.0.0 and
   then replaced in place by version 1.1.0 (same ID). crxdiff's
   `management.onInstalled` listener records an event whose `version` is
   `1.1.0`, within 5 seconds.
2. If (1) fails, the polling path alone must detect the version change on its
   next run.

Known limit of the method: a genuine Web Store update cannot be triggered on
demand in a test browser. The test uses a reload of an unpacked extension with a
higher version, which Chrome reports through the same `ExtensionRegistry`
"installed" path that store updates use. That this matches store updates in
every Chrome version is an inference, not something this experiment proves.

## Hypothesis 3: the baseline package matches the installed version

> The store serves only the newest version. When the first baseline is taken,
> the downloaded package's `version` must be compared with the installed
> `version`, and a mismatch must be recorded honestly instead of silently used
> as a baseline.

Success criteria:

1. The engine's baseline step marks a snapshot `matched` when versions are equal
   and `mismatch` (with both versions) when they differ, covered by unit tests.
2. For the real IDs downloaded in hypothesis 1, the versions reported by the
   update server are recorded, so a mismatch rate can be observed later.

## Results (2026-10-30, Chrome for Testing 156.0.8078.80)

### Hypothesis 1: passed

Node (`node scripts/experiment/node-fetch.mjs`) and the extension service worker
(`scripts/experiment/browser-run.mjs`, which calls the same code the extension runs)
got the same results:

| Extension | ID | Version served | CRX | `crx_id` matches | Files | Download | Analysis in the service worker |
|---|---|---|---|---|---|---|---|
| uBlock Origin Lite | `ddkjiahejlhfcafbddmgiahcphecmpfh` | 2026.1026.1812 | CRX3, 9.0 MB | yes | 929 | 200, redirected to `clients2.googleusercontent.com` | 537 ms |
| Dark Reader | `eimadpbcbfnmbkopoojfekhnkhdbieeh` | 4.9.134 | CRX3, 0.86 MB | yes | 89 | same | 53 ms |
| Bitwarden | `nngceckbapebfimnlniiiahkandclblb` | 2026.10.1 | CRX3, 26 MB | yes | 201 | same | 1,282 ms |
| React Developer Tools | `fmkadmapgofadopljbjfkapdkoienihi` | 8.0.0 | CRX3, 0.67 MB | yes | 61 | same | 64 ms |

- No CORS error: the host permissions are enough for the redirect from
  `clients2.google.com` (HTTP 302) to `clients2.googleusercontent.com`.
- Control: from the same service worker, `fetch('https://www.google.com/robots.txt')`
  fails ("Failed to fetch"). The extension's CSP limits `connect-src` to the two
  update hosts, so the successful downloads also show that no other host is involved.
- `fflate` is vendored as a tree-shaken file (`src/vendor/fflate.js`, rebuilt with
  `npm run vendor:fflate`) that contains only the streaming DEFLATE decoder: no
  Worker or Blob code, no remote code.
- The analysis times are for the whole snapshot (unpacking, SHA-256 of every file,
  host and pattern scanning) and vary a little between runs.

### Hypothesis 2: passed

A probe extension was loaded at 1.0.0 (permission `storage`) and then reloaded from
the same folder as 1.1.0 (adding `scripting`). crxdiff's
`chrome.management.onInstalled` listener received an event with `version: "1.1.0"`
**8 ms** after the reload call returned (7 ms on an earlier run). Right after,
`management.getAll()` reported version 1.1.0 with the new permission list, so the
polling fallback sees the same change.

Not proven here, as planned: that a genuine Web Store auto-update fires the same
event. Chrome for Testing cannot be made to install an older store version on demand.
crxdiff therefore uses both paths (the event, and an `alarms` poll that compares
versions every 1 to 24 hours plus a check at browser start-up), so a missed event only
delays detection until the next poll.

Also observed: for an unpacked extension `updateUrl` is `undefined` and
`installType` is `"development"`. For store-installed extensions crxdiff expects
`updateUrl` to be `https://clients2.google.com/service/update2/crx`; that value
could not be observed in this test browser, so crxdiff also accepts a missing
`updateUrl` for `installType: "normal"` and relies on the download (and the
`crx_id` check) to confirm the item is in the store. **Unverified** on a real profile.

### Hypothesis 3: passed (logic), observation recorded

- `baselineStatus()` returns `matched`, `store-ahead` or `store-behind`; unit tests
  cover all three (`test/diff.test.js`), and `test/monitor.test.js` covers what
  happens next: an ahead baseline is kept and the next update is reported as
  "permissions only", a behind baseline is not kept and is retried.
- On 2026-10-30 the versions served by the update server for the four IDs above were
  the same as the newest public releases on GitHub for the three that publish there
  (uBlock Origin Lite 2026.1026.1812, Dark Reader 4.9.134, Bitwarden 2026.10.1). The
  mismatch rate on real profiles is not measured yet.

### Extra check: noise on routine updates

`node scripts/noise.mjs <dir>` runs the engine on consecutive real releases downloaded
from GitHub by `node scripts/fetch-real-releases.mjs <dir>`. On 2026-10-30, 26
updates of six extensions (uBlock Origin Lite, Dark Reader, Violentmonkey,
SponsorBlock, Stylus, Bitwarden) gave **24 "nothing notable" and 2 "low"** (5 points
each, one new site in uBlock Origin Lite's code), and none "worth a look" or "high".
The simulated QuickLens-style update in `test/fixtures/page-notes-4.2.0` scores
**high (122 points)**.
