# Test fixtures

`page-notes-*` is a small, made-up extension in three versions. The hosts use the
reserved `.test` top-level domain, so none of them resolve.

| Version | What it simulates |
|---|---|
| 4.1.2 | The baseline |
| 4.1.3 | A routine update: a bug fix and a new translation. Should score **none/low**. |
| 4.2.0 | A malicious update in the style of QuickLens (February 2026): a warning-free permission, static rules that strip `Content-Security-Policy` and `X-Frame-Options`, a new remote host and code that injects remote scripts. Should score **high**. |

The tests zip these folders in memory (`test/helpers/pack.js`). They are never loaded
into a browser as-is.
