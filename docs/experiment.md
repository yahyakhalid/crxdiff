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

## Results

_Filled in after running; see below._
