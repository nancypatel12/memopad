// The right-click menu: Save to Memopad (selected text) or Save page to
// Memopad (the page itself).

import { addNote, noteFromPage } from "./lib/store.js";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: "save", title: "Save to Memopad", contexts: ["selection"] });
    chrome.contextMenus.create({ id: "save-page", title: "Save page to Memopad", contexts: ["page"] });
  });
});

// The click grants activeTab, which is what exposes the tab's URL and title.
// info.pageUrl is the fallback when the tab's details aren't available.
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const note = noteFromPage(info.menuItemId, info, tab);
  if (note) await addNote(note);
});
