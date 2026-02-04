
// --- Session Notes Persistence ---
function setupSessionNotes() {
    const noteArea = document.getElementById('session-notes');
    if (!noteArea) return;

    const STORAGE_KEY_NOTES = 'akt-session-notes';

    // Load saved notes
    const savedNotes = localStorage.getItem(STORAGE_KEY_NOTES);
    if (savedNotes) {
        noteArea.value = savedNotes;
    }

    // Save on input
    noteArea.addEventListener('input', (e) => {
        localStorage.setItem(STORAGE_KEY_NOTES, e.target.value);
    });
}

// Call this in initializeApp
