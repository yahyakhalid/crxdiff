(function () {
  const key = location.href;
  chrome.storage.local.get('notes').then(({ notes = {} }) => {
    if (!notes[key] || notes[key].length === 0) return;
    const badge = document.createElement('div');
    badge.textContent = String(notes[key].length);
    badge.style.cssText = 'position:fixed;bottom:12px;right:12px;z-index:2147483647';
    document.documentElement.append(badge);
  });
})();
