# Design sources

- `icon.svg` (32, 48 and 128 px) and `icon-small.svg` (16 px, thicker strokes) are the
  extension icon: a change sign (Δ) over a highlighter stroke. Render them with
  `CHROME=/path/to/chrome node scripts/render-icons.mjs`; the Web Store copy
  (`store/icon-128.png`) gets 16 px of transparent padding.
- `art.html` builds the README banners (`docs/images/banner.png`, `banner-ar.png`,
  1280x640 at 2x), the social preview (`docs/images/social-preview.png`, 1280x640)
  and the Web Store promo images. It uses real screenshots from `docs/images/`.
  Render with `CHROME=/path/to/chrome node scripts/render-art.mjs 8807`, which serves
  `docs/` on `127.0.0.1:8807` while it runs and stops the server afterwards.
- Screenshots of the extension come from
  `CHROME=/path/to/chrome-for-testing node scripts/screenshots.mjs <out> <real-releases-dir> --lang=en|ar [--scale=2]`.
  It loads `src/` unpacked and fills it with the demo state from
  `scripts/demo-state.mjs`: a simulated malicious update plus real diffs between
  public releases.

Visual identity: ink navy (`#17213b`) and a cool paper (`#f3f4ef`), with a
highlighter yellow (`#ffd43b`, `#ffe066`) that marks what is new. Points are tallied
like a ledger and the risk level is a stamp. Risk colors always come with a shape
(▲ ◆ ● ○), so they never rely on color alone.
