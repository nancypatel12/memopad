document.addEventListener('DOMContentLoaded', () => {
    const notesContainer = document.getElementById('notes');
    const addNoteButton = document.getElementById('add-note');
    const newNoteTextarea = document.getElementById('new-note');
    
    loadNotes();

    addNoteButton.addEventListener('click', () => {
        const noteText = newNoteTextarea.value.trim();
        if (noteText) {
            createNote(noteText);
            newNoteTextarea.value = '';
        }
    });

    function createNote(text) {
        const note = document.createElement('div');
        note.className = 'note';
        note.contentEditable = true;
        note.innerHTML = text.replace(/\n/g, '<br>');

        const deleteButton = document.createElement('button');
        deleteButton.textContent = 'X';
        deleteButton.style.position = 'absolute';
        deleteButton.style.top = '5px';
        deleteButton.style.right = '5px';
        deleteButton.addEventListener('click', () => {
            notesContainer.removeChild(note);
            saveNotes();
        });

        note.appendChild(deleteButton);
        notesContainer.appendChild(note);

        note.addEventListener('blur', saveNotes);

        note.addEventListener('focus', () => {
            note.style.borderColor = '#fc79b0';
        });

        note.addEventListener('blur', () => {
            note.style.borderColor = '#f5d2e4';
        });

        saveNotes();
    }

    function loadNotes() {
        const notes = JSON.parse(localStorage.getItem('stickyNotes')) || [];
        notes.forEach(noteText => createNote(noteText));
    }

    function saveNotes() {
        const notes = Array.from(notesContainer.children).map(note => note.innerHTML.replace(/<br>/g, '\n').trim());
        localStorage.setItem('stickyNotes', JSON.stringify(notes));
    }
});