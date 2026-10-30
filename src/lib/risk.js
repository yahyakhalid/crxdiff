// Points and thresholds. Every finding carries its own points and a message key, so the
// score shown to the user is always the sum of reasons they can read.

export const LEVELS = Object.freeze({ HIGH: 50, MEDIUM: 20 });

export function levelFor(score) {
  if (score >= LEVELS.HIGH) return 'high';
  if (score >= LEVELS.MEDIUM) return 'medium';
  if (score > 0) return 'low';
  return 'none';
}

// Permission → whether Chrome shows an install/update warning for it, and the points a
// newly added one is worth. Warning text per
// https://developer.chrome.com/docs/extensions/reference/permissions-list (checked 2026-10-30).
export const PERMISSIONS = Object.freeze({
  // Warning-less, but powerful: an update can add these and Chrome says nothing.
  scripting: { warns: false, points: 25 },
  cookies: { warns: false, points: 20 },
  webRequest: { warns: false, points: 20 },
  webRequestBlocking: { warns: false, points: 20 },
  declarativeNetRequestWithHostAccess: { warns: false, points: 20 },
  userScripts: { warns: false, points: 30 },
  offscreen: { warns: false, points: 10 },
  activeTab: { warns: false, points: 5 },
  background: { warns: false, points: 10 },
  browsingData: { warns: false, points: 15 },
  identity: { warns: false, points: 10 },
  contextMenus: { warns: false, points: 2 },
  sidePanel: { warns: false, points: 2 },
  storage: { warns: false, points: 0 },
  unlimitedStorage: { warns: false, points: 2 },
  alarms: { warns: false, points: 2 },
  idle: { warns: false, points: 2 },
  // Warning permissions: the user was asked, but still worth showing.
  debugger: { warns: true, points: 40 },
  nativeMessaging: { warns: true, points: 30 },
  proxy: { warns: true, points: 30 },
  management: { warns: true, points: 25 },
  privacy: { warns: true, points: 20 },
  contentSettings: { warns: true, points: 20 },
  pageCapture: { warns: true, points: 20 },
  tabCapture: { warns: true, points: 20 },
  desktopCapture: { warns: true, points: 20 },
  webAuthenticationProxy: { warns: true, points: 30 },
  history: { warns: true, points: 20 },
  sessions: { warns: true, points: 10 },
  tabs: { warns: true, points: 10 },
  webNavigation: { warns: true, points: 10 },
  declarativeNetRequest: { warns: true, points: 10 },
  declarativeNetRequestFeedback: { warns: true, points: 10 },
  clipboardRead: { warns: true, points: 15 },
  clipboardWrite: { warns: true, points: 5 },
  downloads: { warns: true, points: 10 },
  'downloads.open': { warns: true, points: 10 },
  bookmarks: { warns: true, points: 10 },
  topSites: { warns: true, points: 10 },
  geolocation: { warns: true, points: 15 },
  'identity.email': { warns: true, points: 15 },
  favicon: { warns: true, points: 5 },
  notifications: { warns: true, points: 2 },
  readingList: { warns: true, points: 5 },
  tabGroups: { warns: true, points: 5 },
  ttsEngine: { warns: true, points: 5 },
});

export function permissionInfo(name) {
  // Own properties only: a permission named "constructor" must not reach Object.prototype.
  return typeof name === 'string' && Object.hasOwn(PERMISSIONS, name) ? PERMISSIONS[name] : { warns: null, points: 5 };
}

export const PATTERN_POINTS = Object.freeze({
  eval: 20,
  'function-constructor': 15,
  'string-timer': 10,
  'document-write': 5,
  'script-element': 10,
  'remote-import-scripts': 40,
  'remote-dynamic-import': 40,
  'execute-script': 5,
  'execute-script-code': 30,
  'dynamic-header-rules': 30,
  websocket: 5,
});

export const POINTS = Object.freeze({
  hostBroad: 40,
  hostEach: 10,
  hostCap: 30,
  matchBroad: 30,
  matchEach: 8,
  matchCap: 24,
  mainWorld: 15,
  cspChanged: 10,
  cspUnsafeEval: 30,
  cspRemote: 30,
  updateUrlChanged: 50,
  homepageChanged: 5,
  authorChanged: 10,
  externallyConnectable: 10,
  dnrSecurityHeader: 40,
  siteEach: 5,
  siteCap: 20,
  obfuscatedEach: 30,
  obfuscatedCap: 40,
  wasm: 10,
  sizeJump: 5,
  remoteCodeCombo: 15,
});

/** Points for a finding, mapped to a display severity. */
export function severityFor(points) {
  if (points >= 30) return 'high';
  if (points >= 10) return 'medium';
  if (points > 0) return 'low';
  return 'info';
}
