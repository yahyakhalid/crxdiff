# Privacy policy · سياسة الخصوصية

_crxdiff 0.1 · last updated 2026-10-30 · آخر تحديث 2026-10-30_

[English](#english) · [العربية](#العربية)

## English

crxdiff is a browser extension that compares each update of your installed extensions with the previous version. It is built so that your data stays on your device.

**What crxdiff collects:** nothing. The developer receives no data of any kind: no analytics, no telemetry, no crash reports, no account.

**What it stores on your device** (in `chrome.storage.local`, which only crxdiff can read):
- the list of your installed extensions, their versions and status;
- for each checked extension, a summary of its package: the manifest, file names, sizes and SHA-256 hashes, host names found in its code, and counts of certain code patterns (not the source code);
- update reports and your settings.

You can export this data as a JSON file, or delete all of it, from crxdiff's Settings page. Uninstalling crxdiff deletes it too.

**What it sends over the network:** only download requests to Google's extension update servers, `https://clients2.google.com` and `https://clients2.googleusercontent.com`, to fetch the packages of extensions you already have installed. Each request contains the extension's ID and your Chrome version, the same kind of request Chrome makes when it updates extensions. These requests go directly from your browser to Google and are covered by [Google's Privacy Policy](https://policies.google.com/privacy). crxdiff contacts no other server.

**What it does with your extensions:** it reads their list and versions through Chrome's `management` API. It turns an extension off only if you enable "Turn off an extension when its update is high risk", and turns it back on only when you ask.

**Data sharing and sale:** none. crxdiff does not sell, transfer or share any data, does not use it for advertising or creditworthiness, and does not use it for any purpose other than showing you what changed in your extensions.

**Contact:** open an issue at https://github.com/yahyakhalid/crxdiff/issues, or report privately as described in [SECURITY.md](SECURITY.md).

Changes to this policy will be recorded in this file and in [CHANGELOG.md](CHANGELOG.md).

<div dir="rtl">

## العربية

crxdiff إضافة للمتصفح تقارن كل تحديث لإضافاتك المثبّتة بالنسخة التي قبله، وقد صُممت بحيث تبقى بياناتك على جهازك.

**ما يجمعه crxdiff:** لا شيء. لا يصل إلى المطوّر أي نوع من البيانات: لا تحليلات، ولا قياس استخدام، ولا تقارير أعطال، ولا حساب.

**ما يحفظه على جهازك** (في `chrome.storage.local`، ولا يقرؤه إلا crxdiff):
- قائمة إضافاتك المثبّتة ونسخها وحالتها؛
- ملخصاً لحزمة كل إضافة يفحصها: manifest، وأسماء الملفات وأحجامها وبصماتها (SHA-256)، وأسماء المواقع الواردة في الكود، وعدد مرات ظهور أنماط معيّنة في الكود (لا الكود المصدري نفسه)؛
- تقارير التحديثات وإعداداتك.

تستطيع تصدير هذه البيانات في ملف JSON أو حذفها كلها من صفحة الإعدادات في crxdiff، وتُحذف أيضاً عند إزالة الإضافة.

**ما يرسله عبر الشبكة:** طلبات تنزيل فقط إلى خوادم التحديث التابعة لـ Google، أي `https://clients2.google.com` و`https://clients2.googleusercontent.com`، لجلب حزم الإضافات المثبّتة عندك أصلاً. يحمل كل طلب معرّف الإضافة ونسخة كروم لديك، وهو من نوع الطلبات نفسه الذي يرسله كروم حين يحدّث الإضافات. تذهب هذه الطلبات مباشرة من متصفحك إلى Google وتخضع [لسياسة خصوصية Google](https://policies.google.com/privacy). لا يتصل crxdiff بأي خادم آخر.

**ما يفعله بإضافاتك:** يقرأ قائمتها ونسخها عبر واجهة `management` في كروم. ولا يوقف إضافة إلا إذا فعّلت خيار «أوقف الإضافة إذا كان تحديثها عالي الخطورة»، ولا يعيد تشغيلها إلا بطلب منك.

**مشاركة البيانات وبيعها:** لا يحدث أي منهما. لا يبيع crxdiff أي بيانات ولا ينقلها ولا يشاركها، ولا يستخدمها للإعلانات أو لتقييم الأهلية الائتمانية، ولا لأي غرض غير أن يريك ما تغيّر في إضافاتك.

**التواصل:** افتح بلاغاً على https://github.com/yahyakhalid/crxdiff/issues، أو أبلغ بشكل خاص كما في [SECURITY.md](SECURITY.md).

أي تغيير على هذه السياسة سيُسجَّل في هذا الملف وفي [CHANGELOG.md](CHANGELOG.md).

</div>
