# Chrome Web Store listing (English)

## Name (max 75)

crxdiff: what changed in your extensions

## Short description (max 132)

See what each extension update changed: new permissions, new sites in the code, risky code. Local only, no data collected.

## Detailed description

Chrome extensions update themselves silently. Chrome only stops an update that adds a permission with a warning. Everything else, including brand-new code inside permissions the extension already had, installs without a word. That is how several well-known extensions turned malicious after a change of owner or a hacked developer account.

crxdiff keeps a local summary of each extension you have installed from the Chrome Web Store. When one updates, it downloads the new version from Google's update server, compares it with the previous one and shows you what changed:

• New permissions, marked clearly when Chrome showed you no warning for them
• New site access and new pages where its scripts run
• Content Security Policy changes, such as allowing eval
• Sites named in the code for the first time
• Code that runs text as code, loads remote scripts or injects scripts into tabs, when it appears for the first time
• Network rules that remove security headers such as Content-Security-Policy from websites
• New obfuscated or WebAssembly files, unusual package structure, big size jumps
• A changed update source, homepage or author
• A file-by-file list and a manifest.json diff

Every finding has its own points and a plain-language reason, so you can see why an update is "worth a look" (20 points or more) or "high risk" (50 or more). Routine updates stay quiet: on 26 real consecutive releases of six popular extensions, 24 had nothing notable and 2 were low.

Optional: turn off an extension automatically when its update is high risk, with one click to turn it back on.

Private by design
• No account, no analytics, no telemetry, no remote code.
• Everything is stored on your device; export or delete it from Settings.
• The only network requests go to Google's update servers (clients2.google.com and clients2.googleusercontent.com), to download extensions you already have.

Good to know
• crxdiff reports after Chrome has installed an update. It is a detector, not a blocker, unless you turn on automatic turn-off.
• It reads code as text. It flags obfuscation but cannot tell what obfuscated code does.
• Only Chrome Web Store extensions are checked. Unpacked, policy-installed and self-hosted extensions are listed with the reason they are not checked.
• Experimental version 0.1. Open source (MIT): https://github.com/yahyakhalid/crxdiff

Available in English and Arabic.
