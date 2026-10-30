document.getElementById('note').addEventListener('change', (e) => {
  chrome.storage.local.set({ draft: e.target.value });
});
