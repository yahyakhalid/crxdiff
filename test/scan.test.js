import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractHosts, cleanHost, siteOf, scanPatterns, codeShape, scanDnrRules } from '../src/lib/scan.js';

test('extracts hosts from http, https, ws and JSON-escaped URLs', () => {
  const t = 'fetch("https://api.Example-Shop.io/v1"); x="wss://live.chat.test/s"; y="https:\\/\\/cdn.foo.co.uk\\/a.js" http://10.0.0.5:8080/';
  assert.deepEqual([...extractHosts(t)].sort(), ['10.0.0.5', 'api.example-shop.io', 'cdn.foo.co.uk', 'live.chat.test']);
});

test('ignores XML namespaces, placeholders, loopback and malformed hosts', () => {
  const t = 'http://www.w3.org/2000/svg https://example.com/x http://127.0.0.1/ http://localhost:3000 https://a..b https://-bad-.com https://x.y1 https://999.1.1.1/';
  assert.deepEqual([...extractHosts(t)], []);
  assert.equal(cleanHost('Trailing.Dot.com.'), 'trailing.dot.com');
  assert.equal(cleanHost('xn--mgbh0fb.xn--kgbechtv'), 'xn--mgbh0fb.xn--kgbechtv');
});

test('groups hosts by approximate registrable domain', () => {
  assert.equal(siteOf('a.b.example.com'), 'example.com');
  assert.equal(siteOf('cdn.shop.co.uk'), 'shop.co.uk');
  assert.equal(siteOf('me.github.io'), 'me.github.io');
  assert.equal(siteOf('x.y.s3.amazonaws.com'), 'y.s3.amazonaws.com');
  assert.equal(siteOf('1.2.3.4'), '1.2.3.4');
});

test('detects risky patterns without matching look-alikes', () => {
  const hits = scanPatterns(`
    eval(code); window.eval(x); page.eval("not this"); evaluate(1);
    new Function("return 1"); Function('a', 'return a'); myFunction("x");
    setTimeout("alert(1)", 10); setTimeout(() => {}, 10);
    document.write('<p>'); document.createElement('script');
    importScripts('https://evil.test/w.js'); importScripts('local.js');
    import("https://evil.test/m.js"); import('./local.js');
    chrome.scripting.executeScript({ target }); chrome.tabs.executeScript(1, { code: 'x' });
    new WebSocket('wss://a.test');
  `);
  assert.equal(hits.eval, 2);
  assert.equal(hits['function-constructor'], 2);
  assert.equal(hits['string-timer'], 1);
  assert.equal(hits['document-write'], 1);
  assert.equal(hits['script-element'], 1);
  assert.equal(hits['remote-import-scripts'], 1);
  assert.equal(hits['remote-dynamic-import'], 1);
  assert.equal(hits['execute-script'], 2);
  assert.equal(hits['execute-script-code'], 1);
  assert.equal(hits.websocket, 1);
});

test('dynamic header rules count only with a security header in the same file', () => {
  assert.equal(scanPatterns('chrome.declarativeNetRequest.updateDynamicRules({addRules})')['dynamic-header-rules'], undefined);
  const evil = 'updateSessionRules({addRules:[{action:{type:"modifyHeaders",responseHeaders:[{header:"Content-Security-Policy",operation:"remove"}]}}]})';
  assert.equal(scanPatterns(evil)['dynamic-header-rules'], 1);
});

test('code shape: obfuscator output is flagged, ordinary minified code is not', () => {
  const minified = 'var a=1;'.repeat(5000);
  assert.deepEqual([codeShape(minified).minified, codeShape(minified).obfuscated], [true, false]);
  const obf = Array.from({ length: 60 }, (_, i) => `var _0x${(0x1a2b + i).toString(16)}=_0x4f2c[${i}];`).join('');
  assert.equal(codeShape(obf).obfuscated, true);
  const hex = '"' + '\\x41'.repeat(2000) + '"';
  assert.equal(codeShape(hex).obfuscated, true);
  const blob = 'const b="' + 'QUJD'.repeat(6000) + '";';
  assert.equal(codeShape(blob).obfuscated, true);
  assert.equal(codeShape('function add(a, b) {\n  return a + b;\n}\n').obfuscated, false);
});

test('static DNR rules that strip security headers are found', () => {
  const rules = [
    { action: { type: 'modifyHeaders', responseHeaders: [{ header: 'Content-Security-Policy', operation: 'remove' }, { header: 'X-Custom', operation: 'remove' }] } },
    { action: { type: 'modifyHeaders', responseHeaders: [{ header: 'x-frame-options', operation: 'set', value: 'ALLOWALL' }] } },
    { action: { type: 'modifyHeaders', requestHeaders: [{ header: 'origin', operation: 'remove' }] } },
    { action: { type: 'block' } },
    null,
    { action: { type: 'modifyHeaders', responseHeaders: [null, { header: 42 }] } },
  ];
  assert.deepEqual(scanDnrRules(rules), { 'content-security-policy:remove': 1, 'x-frame-options:set': 1 });
  assert.deepEqual(scanDnrRules({ not: 'an array' }), {});
});

test('scanners stay linear on adversarial input (no catastrophic backtracking)', () => {
  const inputs = [
    'https://' + 'a.'.repeat(400000),
    'https://' + 'a-'.repeat(400000) + '!',
    'eval'.repeat(200000) + ' (',
    'executeScript({' + ' '.repeat(500000),
    'new' + ' '.repeat(500000) + 'Function',
    'setTimeout(' + ' '.repeat(500000),
    'createElement(' + ' '.repeat(500000),
    '_0x'.repeat(300000),
    'A'.repeat(3000000),
  ];
  for (const s of inputs) {
    const t0 = performance.now();
    extractHosts(s);
    scanPatterns(s);
    codeShape(s);
    const ms = performance.now() - t0;
    assert.ok(ms < 2000, `took ${ms.toFixed(0)} ms on input starting ${JSON.stringify(s.slice(0, 20))}`);
  }
});
