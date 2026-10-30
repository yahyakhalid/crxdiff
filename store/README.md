# Chrome Web Store submission kit

Everything needed to submit crxdiff 0.1.0. Nothing here has been submitted yet.

| Item | File |
|---|---|
| Package to upload | `dist/crxdiff-0.1.0.zip` (run `npm run build`) |
| Listing text, English | [listing-en.md](listing-en.md) |
| Listing text, Arabic | [listing-ar.md](listing-ar.md) |
| Privacy practices tab (single purpose, permissions, data use) | below |
| Privacy policy URL | `https://github.com/yahyakhalid/crxdiff/blob/main/PRIVACY.md` (bilingual) |
| Store icon, 128x128 (96x96 artwork with 16 px padding) | `icon-128.png` |
| Screenshots, 1280x800, English | `screenshots/en/01-report.png` … `05-settings.png` |
| Screenshots, 1280x800, Arabic | `screenshots/ar/01-report.png` … `05-settings.png` |
| Small promo tile, 440x280 | `promo-tile-440x280.png` (Arabic: `promo-tile-440x280-ar.png`) |
| Marquee promo tile, 1400x560 (optional) | `marquee-1400x560.png` (Arabic: `marquee-1400x560-ar.png`) |

Screenshots are real extension pages captured in Chrome for Testing with
`scripts/screenshots.mjs`. The data is simulated: "Page Notes" is a made-up
extension whose update imitates QuickLens (February 2026); the other reports are
real diffs between public releases. `02-popup.png` places the real popup next to
a caption (`scripts/render-art.mjs`).

## Category

**Privacy & Security** (alternative: Developer Tools).

## Language

Default locale `en`; also `ar` (`src/_locales`). Upload the Arabic listing text and
screenshots under the Arabic localisation.

## Single purpose

> crxdiff shows the user what changed in each update of the browser extensions they
> have installed, by comparing the new package with the previous one, and can
> optionally turn off an extension whose update is high risk.

## Permission justifications

| Permission | Justification |
|---|---|
| `management` | Core function. Reads the list of installed extensions, their versions, install type and update URL to know which ones to check and when one has updated (`management.onInstalled` and `getAll`). Uses `setEnabled` only to turn off an extension whose update is high risk when the user enabled that option, and to turn it back on when the user asks. Also shows each extension's icon in reports. |
| `storage` | Stores, on the device only, the summary of each extension's previous version (manifest, file hashes and sizes, hosts named in code), the update reports and the user's settings. |
| `alarms` | Runs the update check on a schedule the user chooses (every 1 to 24 hours), so updates are found even if the install event was missed or the browser was closed. |
| `notifications` | Tells the user when an update is "worth a look" or "high risk", with buttons to open the report or turn the extension back on. Can be turned off in Settings. |
| Host `https://clients2.google.com/*` | Downloads the current package of an installed extension from the Chrome Web Store update server (`/service/update2/crx`), the same endpoint Chrome uses for updates. |
| Host `https://clients2.googleusercontent.com/*` | The update server redirects package downloads to this host; the package is read in memory and summarised. |

**Remote code:** No. All JavaScript is in the package. Downloaded extension packages
are parsed as data and never executed or injected.

## Data usage disclosures

- Collected data: **none** of the listed categories (personally identifiable
  information, health, financial, authentication, personal communications,
  location, web history, user activity, website content).
- Note for the reviewer: the extension reads the list of installed extensions and
  stores a summary of their packages **on the device only**. Nothing is transmitted
  to the developer or any third party.
- Certify: data is not sold to third parties; not used or transferred for purposes
  unrelated to the single purpose; not used or transferred to determine
  creditworthiness or for lending.

## Test instructions for the reviewer

1. Load the extension; it takes baselines of installed Web Store extensions in the
   background (the popup shows "Watching N extensions").
2. To see a report without waiting for a real update, open any report from the
   popup after an update, or run the engine on two packages:
   `node scripts/compare.mjs old.crx new.crx` from the source repository.
3. Settings > "Turn off an extension when its update is high risk" is off by default.
