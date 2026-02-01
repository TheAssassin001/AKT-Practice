// Flagged Questions Page - Display and manage flagged questions
import { supabase } from './supabase.js';

const FLAGGED_QUESTIONS_KEY_PRACTICE = 'akt-flagged-questions-practice';
const FLAGGED_QUESTIONS_KEY_EXAM = 'akt-flagged-questions-exam';

let currentFilter = 'all'; // 'all', 'practice', 'exam'

// Initialize tabs and load questions
function initializePage() {
    setupTabs();
    loadFlaggedQuestions(currentFilter);
}

// Setup tab handlers
function setupTabs() {
    const tabs = document.querySelectorAll('.flag-tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', function () {
            // Update active state
            tabs.forEach(t => {
                t.classList.remove('active');
                // Reset inline styles
                t.style.borderBottom = '3px solid transparent';
                t.style.color = '#666';
            });
            this.classList.add('active');
            // Set active inline styles
            this.style.borderBottom = '3px solid #1976d2';
            this.style.color = '#1976d2';

            // Update filter and reload
            currentFilter = this.getAttribute('data-filter');
            loadFlaggedQuestions(currentFilter);
        });
    });
}

// Load all flagged questions from persistent storage
function loadFlaggedQuestions(filter = 'all') {
    const container = document.getElementById('flagged-container');
    const noFlaggedDiv = document.getElementById('no-flagged');

    // Get flagged questions from both keys
    const practiceData = localStorage.getItem(FLAGGED_QUESTIONS_KEY_PRACTICE);
    const examData = localStorage.getItem(FLAGGED_QUESTIONS_KEY_EXAM);

    let allFlagged = {};

    try {
        // Parse and merge based on filter
        const practiceFlagged = practiceData ? JSON.parse(practiceData) : {};
        const examFlagged = examData ? JSON.parse(examData) : {};

        // Add mode identifier to each question
        if (filter === 'all' || filter === 'practice') {
            Object.keys(practiceFlagged).forEach(id => {
                allFlagged[id] = { ...practiceFlagged[id], mode: 'practice' };
            });
        }

        if (filter === 'all' || filter === 'exam') {
            Object.keys(examFlagged).forEach(id => {
                // If question is flagged in both modes, show both (use composite key)
                if (allFlagged[id] && filter === 'all') {
                    allFlagged[`${id}-exam`] = { ...examFlagged[id], mode: 'exam', originalId: id };
                    allFlagged[`${id}-practice`] = { ...allFlagged[id], originalId: id };
                    delete allFlagged[id];
                } else {
                    allFlagged[id] = { ...examFlagged[id], mode: 'exam' };
                }
            });
        }

        console.log('Loaded flagged questions:', allFlagged);

        if (!allFlagged || Object.keys(allFlagged).length === 0) {
            container.style.display = 'none';
            const actionsDiv = document.getElementById('flagged-actions');
            if (actionsDiv) actionsDiv.style.display = 'none';
            noFlaggedDiv.style.display = 'block';
            return;
        }

        // Cleanup: Remove any invalid keys
        let needsCleanupPractice = false;
        let needsCleanupExam = false;
        ['NaN', 'undefined', 'null', ''].forEach(badKey => {
            if (badKey in practiceFlagged) {
                delete practiceFlagged[badKey];
                needsCleanupPractice = true;
            }
            if (badKey in examFlagged) {
                delete examFlagged[badKey];
                needsCleanupExam = true;
            }
        });
        if (needsCleanupPractice) {
            localStorage.setItem(FLAGGED_QUESTIONS_KEY_PRACTICE, JSON.stringify(practiceFlagged));
        }
        if (needsCleanupExam) {
            localStorage.setItem(FLAGGED_QUESTIONS_KEY_EXAM, JSON.stringify(examFlagged));
        }

        // Extract question IDs (handle composite keys)
        const questionIds = Object.keys(allFlagged)
            .map(key => allFlagged[key].originalId || key)
            .filter((id, index, self) =>
                id && id !== 'NaN' && id !== 'undefined' && id !== 'null' && self.indexOf(id) === index
            );

        console.log('Question IDs to fetch:', questionIds);

        // Fetch question details from Supabase
        fetchFlaggedQuestionDetails(questionIds, allFlagged, filter);

    } catch (error) {
        console.error('Error loading flagged questions:', error);
        container.innerHTML = '<div class="error-message">Error loading flagged questions. Please try again.</div>';
    }
}

async function fetchFlaggedQuestionDetails(questionIds, flaggedData, filter = 'all') {
    const container = document.getElementById('flagged-container');
    const noFlaggedDiv = document.getElementById('no-flagged');
    const actionsDiv = document.getElementById('flagged-actions');

    try {
        // Fetch from Supabase
        const { data, error } = await supabase
            .from('questions')
            .select('*')
            .in('id', questionIds);

        if (error) throw error;

        if (!data || data.length === 0) {
            container.style.display = 'none';
            if (actionsDiv) actionsDiv.style.display = 'none';
            noFlaggedDiv.style.display = 'block';
            return;
        }

        // Questions found - ensure container is visible
        container.style.display = 'block';
        if (actionsDiv) actionsDiv.style.display = 'block';
        noFlaggedDiv.style.display = 'none';

        // Helper for safe JSON parsing (same as practice-mixed.js)
        const safeParse = (val, fallback = []) => {
            if (!val) return fallback;
            if (typeof val !== 'string') return val;
            const trimmed = val.trim();
            if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
                return val;
            }
            try {
                return JSON.parse(val);
            } catch (e) {
                console.warn('Failed to parse JSON:', val, e);
                return val;
            }
        };

        // Normalize question data (parse JSON fields)
        data.forEach(q => {
            // Handle EMQ stem nesting
            if (q.type === 'emq' && q.stem) {
                let stemData = q.stem;
                if (typeof q.stem === 'string') {
                    stemData = safeParse(q.stem, null);
                }
                if (stemData && typeof stemData === 'object') {
                    q.theme = q.theme || stemData.theme;
                    q.options = q.options || stemData.options;
                    q.stems = q.stems || stemData.stems;
                }
            }

            // Normalize JSON fields
            q.options = safeParse(q.options, []);
            q.stems = safeParse(q.stems, []);
            q.furtherReading = safeParse(q.furtherReading, []);
        });

        // Render flagged questions list
        let html = '<div style="display: grid; gap: 1rem;">';

        // Create a map for quick question lookup
        const questionMap = {};
        data.forEach(q => questionMap[q.id] = q);

        // Iterate through flaggedData to render each entry
        Object.keys(flaggedData)
            .sort((a, b) => {
                const timeA = new Date(flaggedData[a].flaggedAt || 0).getTime();
                const timeB = new Date(flaggedData[b].flaggedAt || 0).getTime();
                return timeA - timeB; // Chronological order
            })
            .forEach(key => {
                const flagInfo = flaggedData[key];
                const questionId = flagInfo.originalId || key;
                const question = questionMap[questionId];

                // Skip if question not found
                if (!question) return;

                const statusColor =
                    flagInfo.status === 'correct' ? '#4caf50' :
                        flagInfo.status === 'incorrect' ? '#e53935' :
                            flagInfo.status === 'partial' ? '#ff9800' : '#999';

                const statusText =
                    flagInfo.status === 'correct' ? 'Correct' :
                        flagInfo.status === 'incorrect' ? 'Incorrect' :
                            flagInfo.status === 'partial' ? 'Partial' : 'Not Attempted';

                const modeBadge = flagInfo.mode === 'exam'
                    ? '<span style="background: #ff9800; color: white; padding: 0.25rem 0.75rem; border-radius: 6px; font-size: 0.75rem; font-weight: 600; margin-left: 0.5rem;">Mock</span>'
                    : '<span style="background: #4caf50; color: white; padding: 0.25rem 0.75rem; border-radius: 6px; font-size: 0.75rem; font-weight: 600; margin-left: 0.5rem;">Practice</span>';

                // Use Question Code exactly as in practice-mixed.js
                const displayCode = question['Display Code'] || '';
                const questionCode = question['Question Code'] || '';
                const codeText = displayCode && questionCode
                    ? `${displayCode} ${questionCode}`
                    : (displayCode || questionCode || '');

                // Handle EMQ questions differently - extract first stem text
                let stemPreview = 'No preview available';
                if (question.type === 'emq') {
                    // Debug logging
                    console.log('EMQ Question Data:', question);
                    console.log('EMQ stems field:', question.stems);
                    console.log('EMQ stems type:', typeof question.stems);

                    // Try to parse stems if it's a JSON string
                    try {
                        let stems = question.stems;
                        if (typeof stems === 'string') {
                            stems = JSON.parse(stems);
                        }
                        if (Array.isArray(stems) && stems.length > 0) {
                            const firstStemText = stems[0].stem || stems[0].text || stems[0];
                            const stemCount = stems.length;
                            if (typeof firstStemText === 'string') {
                                stemPreview = firstStemText.length > 120
                                    ? firstStemText.substring(0, 120) + `... (${stemCount} stems total)`
                                    : `${firstStemText} (${stemCount} stems total)`;
                            } else {
                                stemPreview = `EMQ Question (${stemCount} stems)`;
                            }
                        } else if (question.stem) {
                            // Fallback to main stem if exists
                            stemPreview = question.stem.length > 150
                                ? question.stem.substring(0, 150) + '...'
                                : question.stem;
                        } else {
                            stemPreview = 'EMQ Question (multiple stems)';
                        }
                    } catch (e) {
                        console.warn('Could not parse EMQ stems:', e);
                        // Try to use main stem as fallback
                        if (question.stem && typeof question.stem === 'string') {
                            stemPreview = question.stem.length > 150
                                ? question.stem.substring(0, 150) + '...'
                                : question.stem;
                        } else {
                            stemPreview = 'EMQ Question (multiple stems)';
                        }
                    }
                } else {
                    // For non-EMQ questions, use stem as before
                    stemPreview = question.stem ?
                        (question.stem.length > 150 ? question.stem.substring(0, 150) + '...' : question.stem) :
                        'No preview available';
                }

                html += `
        <div class="question-card" onclick="window.location.href='practice-mixed.html?mode=flagged&new=1&startId=${questionId}&filter=${filter}'" style="background: #fff; border: 2px solid #e0e0e0; border-radius: 12px; padding: 1.5rem; transition: all 0.2s ease; cursor: pointer; position: relative;">
          <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 0.75rem;">
            <div>
              <span style="background: #e3f2fd; color: #1565c0; padding: 0.25rem 0.75rem; border-radius: 6px; font-size: 0.75rem; font-weight: 600; margin-right: 0.5rem;">${codeText}</span>
              <span style="background: ${statusColor}; color: white; padding: 0.25rem 0.75rem; border-radius: 6px; font-size: 0.75rem; font-weight: 600;">${statusText}</span>
              ${modeBadge}
            </div>
            <div style="display: flex; align-items: center; gap: 0.5rem;">
              <svg width="20" height="20" viewBox="0 0 13 13" xmlns="http://www.w3.org/2000/svg">
                <path d="M3 2.5V10.5" stroke="#1976d2" stroke-width="2" stroke-linecap="round"/>
                <path d="M3 2.5L10 3.5L7.5 6L10 8.5L3 9.5" fill="#1976d2" stroke="#1976d2" stroke-width="1.5"/>
              </svg>
              <button class="delete-flag-btn" data-question-id="${questionId}" data-mode="${flagInfo.mode}" style="background: #e53935; color: white; border: none; padding: 0.4rem 0.8rem; border-radius: 6px; cursor: pointer; font-size: 0.75rem; font-weight: 600; transition: background 0.2s;">
                Remove
              </button>
            </div>
          </div>
          <div style="color: #333; line-height: 1.6;">${stemPreview}</div>
          ${question.topic ? `<div style="margin-top: 0.75rem; color: #666; font-size: 0.875rem;"><strong>Topic:</strong> ${question.topic}</div>` : ''}
        </div>
      `;
            });

        html += '</div>';
        container.innerHTML = html;

        // Attach delete button handlers
        document.querySelectorAll('.delete-flag-btn').forEach(btn => {
            btn.addEventListener('click', function (e) {
                e.stopPropagation(); // Prevent card click
                const questionId = this.getAttribute('data-question-id');
                const mode = this.getAttribute('data-mode');
                removeFlaggedQuestion(questionId, mode);
            });

            // Hover effect
            btn.addEventListener('mouseenter', function () {
                this.style.background = '#c62828';
            });
            btn.addEventListener('mouseleave', function () {
                this.style.background = '#e53935';
            });
        });

    } catch (error) {
        console.error('Error fetching flagged questions:', error);
        container.innerHTML = `<div class="error-message">Error loading question details: ${error.message || 'Unknown error'}. Please try again.</div>`;
    }
}

// Remove a flagged question from specific mode
function removeFlaggedQuestion(questionId, mode) {
    try {
        const storageKey = mode === 'exam' ? FLAGGED_QUESTIONS_KEY_EXAM : FLAGGED_QUESTIONS_KEY_PRACTICE;
        const flaggedData = JSON.parse(localStorage.getItem(storageKey) || '{}');
        delete flaggedData[questionId];
        localStorage.setItem(storageKey, JSON.stringify(flaggedData));

        // Reload the page to refresh the list
        loadFlaggedQuestions(currentFilter);
    } catch (error) {
        console.error('Error removing flagged question:', error);
        alert('Failed to remove flagged question. Please try again.');
    }
}

// Initialize on page load
window.addEventListener('DOMContentLoaded', initializePage);

// Also handle browser back/forward button navigation
// pageshow fires every time the page is shown, including from cache
window.addEventListener('pageshow', function (event) {
    // If page was restored from cache, reinitialize
    if (event.persisted) {
        // Reset filter to 'all' to avoid showing cached empty state
        currentFilter = 'all';
        // Make sure the correct tab is active
        document.querySelectorAll('.flag-tab').forEach(tab => {
            if (tab.getAttribute('data-filter') === 'all') {
                tab.classList.add('active');
                tab.style.borderBottom = '3px solid #1976d2';
                tab.style.color = '#1976d2';
            } else {
                tab.classList.remove('active');
                tab.style.borderBottom = '3px solid transparent';
                tab.style.color = '#666';
            }
        });
        initializePage();
    }
});

