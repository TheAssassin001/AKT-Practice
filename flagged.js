// Flagged Questions Page - Display and manage flagged questions
import { supabase } from './supabase.js';

const FLAGGED_QUESTIONS_KEY = 'akt-flagged-questions';

// Load all flagged questions from persistent storage
function loadFlaggedQuestions() {
    const container = document.getElementById('flagged-container');
    const noFlaggedDiv = document.getElementById('no-flagged');

    // Get flagged questions from localStorage
    const flaggedData = localStorage.getItem(FLAGGED_QUESTIONS_KEY);

    if (!flaggedData) {
        // No flagged questions, show empty message
        container.style.display = 'none';
        noFlaggedDiv.style.display = 'block';
        return;
    }

    try {
        const flaggedQuestions = JSON.parse(flaggedData);

        console.log('Loaded flagged questions:', flaggedQuestions);

        if (!flaggedQuestions || Object.keys(flaggedQuestions).length === 0) {
            container.style.display = 'none';
            noFlaggedDiv.style.display = 'block';
            return;
        }

        // Cleanup: Remove any invalid keys from localStorage
        let needsCleanup = false;
        ['NaN', 'undefined', 'null', ''].forEach(badKey => {
            if (badKey in flaggedQuestions) {
                delete flaggedQuestions[badKey];
                needsCleanup = true;
            }
        });
        if (needsCleanup) {
            localStorage.setItem(FLAGGED_QUESTIONS_KEY, JSON.stringify(flaggedQuestions));
        }

        // Convert object to array of question IDs, filtering out invalid ones
        const questionIds = Object.keys(flaggedQuestions).filter(id =>
            id && id !== 'NaN' && id !== 'undefined' && id !== 'null'
        );

        console.log('Question IDs to fetch:', questionIds);

        // Fetch question details from Supabase
        fetchFlaggedQuestionDetails(questionIds, flaggedQuestions);

    } catch (error) {
        console.error('Error loading flagged questions:', error);
        container.innerHTML = '<div class="error-message">Error loading flagged questions. Please try again.</div>';
    }
}

async function fetchFlaggedQuestionDetails(questionIds, flaggedData) {
    const container = document.getElementById('flagged-container');
    const noFlaggedDiv = document.getElementById('no-flagged');

    try {
        // Fetch from Supabase
        const { data, error } = await supabase
            .from('questions')
            .select('*')
            .in('id', questionIds);

        if (error) throw error;

        if (!data || data.length === 0) {
            container.style.display = 'none';
            noFlaggedDiv.style.display = 'block';
            return;
        }

        // Render flagged questions list
        let html = '<div style="display: grid; gap: 1rem;">';

        data.forEach(question => {
            const flagInfo = flaggedData[question.id];

            // Skip if no flag info (shouldn't happen, but safety check)
            if (!flagInfo) return;

            const statusColor =
                flagInfo.status === 'correct' ? '#4caf50' :
                    flagInfo.status === 'incorrect' ? '#e53935' :
                        flagInfo.status === 'partial' ? '#ff9800' : '#999';

            const statusText =
                flagInfo.status === 'correct' ? 'Correct' :
                    flagInfo.status === 'incorrect' ? 'Incorrect' :
                        flagInfo.status === 'partial' ? 'Partial' : 'Not Attempted';

            const questionType = question.type?.toUpperCase() || 'QUESTION';
            const stemPreview = question.stem ?
                (question.stem.length > 150 ? question.stem.substring(0, 150) + '...' : question.stem) :
                'No preview available';

            html += `
        <div style="background: #fff; border: 2px solid #e0e0e0; border-radius: 12px; padding: 1.5rem; transition: all 0.2s ease;">
          <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 0.75rem;">
            <div>
              <span style="background: #e3f2fd; color: #1565c0; padding: 0.25rem 0.75rem; border-radius: 6px; font-size: 0.75rem; font-weight: 600; margin-right: 0.5rem;">${questionType}</span>
              <span style="background: ${statusColor}; color: white; padding: 0.25rem 0.75rem; border-radius: 6px; font-size: 0.75rem; font-weight: 600;">${statusText}</span>
            </div>
            <div style="display: flex; align-items: center; gap: 0.5rem;">
              <svg width="20" height="20" viewBox="0 0 13 13" xmlns="http://www.w3.org/2000/svg">
                <path d="M3 2.5V10.5" stroke="#1976d2" stroke-width="2" stroke-linecap="round"/>
                <path d="M3 2.5L10 3.5L7.5 6L10 8.5L3 9.5" fill="#1976d2" stroke="#1976d2" stroke-width="1.5"/>
              </svg>
              <button class="delete-flag-btn" data-question-id="${question.id}" style="background: #e53935; color: white; border: none; padding: 0.4rem 0.8rem; border-radius: 6px; cursor: pointer; font-size: 0.75rem; font-weight: 600; transition: background 0.2s;">
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
            btn.addEventListener('click', function () {
                const questionId = this.getAttribute('data-question-id');
                removeFlaggedQuestion(questionId);
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

// Remove a flagged question
function removeFlaggedQuestion(questionId) {
    try {
        const flaggedData = JSON.parse(localStorage.getItem(FLAGGED_QUESTIONS_KEY) || '{}');
        delete flaggedData[questionId];
        localStorage.setItem(FLAGGED_QUESTIONS_KEY, JSON.stringify(flaggedData));

        // Reload the page to refresh the list
        loadFlaggedQuestions();
    } catch (error) {
        console.error('Error removing flagged question:', error);
        alert('Failed to remove flagged question. Please try again.');
    }
}

// Initialize on page load
window.addEventListener('DOMContentLoaded', loadFlaggedQuestions);

