const stickyNotes = [];

function createStickyNote(text, x, y) {
    const note = document.createElement('div');
    note.className = 'sticky-note';
    note.contentEditable = true;
    note.style.position = 'absolute';
    note.style.left = `${x}px`;
    note.style.top = `${y}px`;
    note.style.width = '200px';
    note.style.maxWidth = 'calc(100% - 20px)';
    note.style.height = '200px';
    note.style.backgroundColor = '#f5eff4';
    note.style.border = '1px solid #f5d2e4';
    note.style.padding = '10px';
    note.style.zIndex = 1000;
    note.style.wordWrap = 'break-word';
    note.style.boxSizing = 'border-box';
    note.innerText = text;

    const deleteButton = document.createElement('button');
    deleteButton.textContent = 'X';
    deleteButton.style.position = 'absolute';
    deleteButton.style.top = '5px';
    deleteButton.style.right = '5px';
    deleteButton.style.color = '#fc79b0';
    deleteButton.style.padding = '0';
    deleteButton.style.margin = '0';
    deleteButton.style.width = '20px';
    deleteButton.style.height = '20px';
    deleteButton.style.lineHeight = '20px';
    deleteButton.style.textAlign = 'center';
    deleteButton.style.fontFamily = 'VCR OSD Mono, monospace';
    deleteButton.addEventListener('click', () => {
        document.body.removeChild(note);
        const index = stickyNotes.indexOf(note);
        if (index > -1) {
            stickyNotes.splice(index, 1);
        }
    });

    note.appendChild(deleteButton);
    stickyNotes.push(note);
    document.body.appendChild(note);

    note.addEventListener('blur', () => {
        const index = stickyNotes.indexOf(note);
        if (index > -1) {
            stickyNotes[index].innerText = note.innerText;
        }
    });

    note.addEventListener('focus', () => {
        note.style.borderColor = '#fc79b0';
    });

    note.addEventListener('input', () => {
        note.style.borderColor = '#fc79b0';
    });

    note.addEventListener('blur', () => {
        note.style.borderColor = '#f5d2e4';
    });
}

function loadStickyNotes() {
    chrome.runtime.sendMessage({ action: 'getAllNotes' }, (response) => {
        if (response.status === 'success') {
            const notes = response.notes;
            for (const key in notes) {
                const note = notes[key];
                createStickyNote(note.content, note.x, note.y);
            }
        }
    });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'createNote') {
        createStickyNote(request.text, request.x, request.y);
    } else if (request.action === 'loadNotes') {
        loadStickyNotes();
    }
});