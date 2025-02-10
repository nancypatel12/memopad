chrome.runtime.onInstalled.addListener(() => {
    console.log("Sticky Notes Extension Installed");
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "saveNote") {
        chrome.storage.local.set({ [request.noteId]: request.noteContent }, () => {
            sendResponse({ status: "success" });
        });
        return true;
    }

    if (request.action === "getNote") {
        chrome.storage.local.get([request.noteId], (result) => {
            sendResponse({ status: "success", noteContent: result[request.noteId] });
        });
        return true;
    }

    if (request.action === "deleteNote") {
        chrome.storage.local.remove([request.noteId], () => {
            sendResponse({ status: "success" });
        });
        return true;
    }

    if (request.action === "getAllNotes") {
        chrome.storage.local.get(null, (items) => {
            sendResponse({ status: "success", notes: items });
        });
        return true;
    }
});