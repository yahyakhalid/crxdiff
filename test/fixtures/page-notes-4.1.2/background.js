chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: 'note', title: 'Add a note', contexts: ['page'] });
});
chrome.contextMenus.onClicked.addListener((info, tab) => {
  chrome.storage.local.get('notes').then(({ notes = {} }) => {
    notes[tab.url] = notes[tab.url] || [];
    chrome.storage.local.set({ notes });
  });
});
// Help page: https://pagenotes.test/help
