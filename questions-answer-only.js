import { supabase } from './supabase.js';

document.addEventListener('DOMContentLoaded', async () => {
    const params = new URLSearchParams(window.location.search);
    const topicId = params.get('topic_id');

    // Setup back links
    const backLink = document.getElementById('back-link');
    const backLinkBottom = document.getElementById('back-link-bottom');
    const targetUrl = topicId ? `study.html?topic_id=${topicId}` : 'study.html';

    if (backLink) backLink.href = targetUrl;

    // Check for ongoing test to update bottom link
    if (backLinkBottom) {
        if (localStorage.getItem('quizStateV3')) {
            backLinkBottom.href = 'practice-mixed.html';
            backLinkBottom.textContent = '← Back to Ongoing Test';
        } else {
            backLinkBottom.href = targetUrl;
        }
    }

    if (!topicId) {
        document.getElementById('qa-content').innerHTML = '<div class="error-message">No topic specified.</div>';
        return;
    }

    await loadQuestions(topicId);
});

// Store questions globally for interaction handlers
let currentQuestions = [];

async function loadQuestions(topicId) {
    const container = document.getElementById('qa-content');

    try {
        const { data: questions, error } = await supabase
            .from('questions')
            .select('*')
            .eq('topic_id', topicId);

        if (error) throw error;

        if (!questions || questions.length === 0) {
            container.innerHTML = '<div class="error-message">No questions found for this topic.</div>';
            return;
        }

        // Store for handlers
        currentQuestions = questions;

        container.innerHTML = questions.map((q, index) => {
            normalizeQuestion(q);
            return renderQuestionBlock(q, index);
        }).join('');

        // Attach event listeners for interactivity
        attachInteractionHandlers();

    } catch (err) {
        console.error('Error loading questions:', err);
        container.innerHTML = '<div class="error-message">Error loading questions. Please try again later.</div>';
    }
}

function attachInteractionHandlers() {
    document.querySelectorAll('.question-block').forEach(block => {
        // SBA/MBA Options
        block.querySelectorAll('.q-option').forEach(opt => {
            opt.addEventListener('click', handleOptionClick);
        });

        // EMQ Stems - simple reveal for now since matching is complex
        block.querySelectorAll('.reveal-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const answerBox = e.target.nextElementSibling;
                if (answerBox) {
                    answerBox.style.display = 'block';
                    e.target.style.display = 'none';
                }
            });
        });
    });
}

function handleOptionClick(e) {
    const optParams = e.currentTarget.dataset;
    const qIdx = parseInt(optParams.qIdx);
    const optIdx = parseInt(optParams.optIdx);

    // Guard
    if (isNaN(qIdx) || isNaN(optIdx)) return;

    const block = document.querySelector(`.question-block[data-q-idx="${qIdx}"]`);
    if (!block || block.classList.contains('answered')) return; // Already answered

    const q = currentQuestions[qIdx];
    if (!q) return;

    // Mark as answered
    block.classList.add('answered');

    // Visual feedback for selected option
    const options = block.querySelectorAll('.q-option');
    options[optIdx].classList.add('selected');

    // Determine correctness (basic support for SBA single correct)
    const correctIdx = q.correct;

    if (typeof correctIdx === 'number') {
        if (optIdx === correctIdx) {
            options[optIdx].classList.add('correct');
            options[optIdx].classList.remove('selected'); // Correct style overrides selected
        } else {
            options[optIdx].classList.add('wrong');
            // Highlight correct one
            if (options[correctIdx]) options[correctIdx].classList.add('correct');
        }
    }

    // Reveal answer box
    const answerBox = block.querySelector('.correct-answer-box');
    if (answerBox) {
        answerBox.style.display = 'block';
        answerBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

// --- Helpers ---

function safeParse(val, fallback = []) {
    if (!val) return fallback;
    if (typeof val !== 'string') return val;
    const trimmed = val.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return val;
    try {
        return JSON.parse(val);
    } catch (e) {
        return val;
    }
}

function normalizeQuestion(q) {
    // Parse JSON fields
    q.options = safeParse(q.options, []);
    q.stems = safeParse(q.stems, []);

    // Normalize correct_answer
    if (typeof q.correct_answer === 'string') {
        const trimmed = q.correct_answer.trim();

        // Case 1: Numeric string ("0", "1")
        if (/^\d+$/.test(trimmed)) {
            q.correct = parseInt(trimmed, 10);
        }
        // Case 2: Letter ("A", "B")
        else if (/^[A-Ei]$/i.test(trimmed)) {
            const code = trimmed.toUpperCase().charCodeAt(0);
            q.correct = code - 65;
        }
        // Case 3: Try parsing as JSON (old logic)
        else {
            q.correct = safeParse(q.correct_answer, null);
        }

        // Case 4: Smart Text Match Fallback
        // If q.correct is still invalid, try to match text against options
        if ((q.correct === null || typeof q.correct !== 'number') && Array.isArray(q.options)) {
            const lowerCorrect = trimmed.toLowerCase();
            const matchIdx = q.options.findIndex(opt => opt.trim().toLowerCase() === lowerCorrect);
            if (matchIdx !== -1) {
                q.correct = matchIdx;
            }
        }
    } else {
        q.correct = q.correct_answer !== undefined ? q.correct_answer : null;
    }
}

function renderQuestionBlock(q, index) {
    let optionsHtml = '';
    let correctText = '';

    // Handle SBA/EMQ options for display context
    // We add data attributes for interactivity
    if (q.type === 'sba' && q.options) {
        optionsHtml = `<div class="q-options">
            ${q.options.map((opt, i) => `
                <div class="q-option" data-q-idx="${index}" data-opt-idx="${i}">
                    ${String.fromCharCode(65 + i)}. ${opt}
                </div>
            `).join('')}
        </div>`;

        const validCorrect = (typeof q.correct === 'number' && q.correct >= 0 && q.correct < q.options.length);
        if (validCorrect) {
            correctText = `${String.fromCharCode(65 + q.correct)}. ${q.options[q.correct]}`;
        } else {
            correctText = 'Unknown (Data Error)';
        }
    } else if (q.type === 'emq' && q.options) {
        // EMQ Options usually not clickable directly in this simple view, 
        // or we could make them clickable but not tied to a specific stem easily.
        // For now, list them statically or interactive? 
        // Let's keep them static for EMQ as interaction is per-stem complex.
        optionsHtml = `<div class="q-options">
            <strong>Options:</strong><br>
            ${q.options.map((opt, i) => `<div class="q-option" style="cursor: default;">${String.fromCharCode(65 + i)}. ${opt}</div>`).join('')}
        </div>`;
    }

    // Special rendering for EMQs which have stems
    if (q.type === 'emq' && q.stems) {
        const stemsHtml = q.stems.map((stem, sIdx) => {
            const cText = `${String.fromCharCode(65 + stem.correct)}. ${q.options[stem.correct]}`;
            return `
                <div style="margin-top: 1.5rem; padding-top: 1rem; border-top: 1px dashed #eee;">
                    <strong>Stem ${sIdx + 1}:</strong> ${stem.stem}
                    <button class="reveal-btn" style="margin-top:0.5rem; padding: 4px 8px; cursor: pointer; background:#eee; border:1px solid #ccc; border-radius:4px;">Reveal Answer</button>
                    <div class="correct-answer-box" style="display:none;">
                        <span class="correct-label">Correct Answer: ${cText}</span>
                        <div class="explanation">${stem.explanation}</div>
                    </div>
                </div>
             `;
        }).join('');

        return `
            <div class="question-block" data-q-idx="${index}">
                <div class="q-header">
                    <span>Question ${index + 1} (${q.type.toUpperCase()})</span>
                    <span>${q['Question Code'] || ''}</span>
                </div>
                <div class="q-stem">${q.stem}</div>
                ${optionsHtml}
                ${stemsHtml}
            </div>
         `;
    }

    // Default SBA/MBA/Numeric rendering
    return `
        <div class="question-block" data-q-idx="${index}">
            <div class="q-header">
                <span>Question ${index + 1} (${q.type ? q.type.toUpperCase() : 'General'})</span>
                <span>${q['Question Code'] || ''}</span>
            </div>
            <div class="q-stem">${q.stem}</div>
            ${optionsHtml}
            
            <div class="correct-answer-box" style="display:none;">
                <span class="correct-label">Correct Answer: ${correctText || 'See Explanation'}</span>
                <div class="explanation">${q.explanation || 'No explanation available.'}</div>
            </div>
        </div>
    `;
}
