import { supabase } from './supabase.js';
import { sanitizeHTML, escapeHTML, stripHTML, formatQuestionCode } from './utils.js';

document.addEventListener('DOMContentLoaded', async () => {
    const params = new URLSearchParams(window.location.search);
    const topicId = params.get('topic_id');

    // Setup back links
    const backLink = document.getElementById('back-link');
    const backLinkBottom = document.getElementById('back-link-bottom');
    const targetUrl = topicId ? `study.html?topic_id=${escapeHTML(topicId)}` : 'study.html';

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

        // Normalize questions using robust logic
        currentQuestions = questions.map((q, index) => {
            const normalized = normalizeQuestion({ ...q }); // Clone to avoid side effects
            normalized._index = index; // Store original index
            return normalized;
        });

        // Use the normalized questions for rendering
        container.innerHTML = currentQuestions.map((q, index) => {
            return renderQuestionBlock(q, index);
        }).join('');

        // Attach event listeners for interactivity
        attachInteractionHandlers();

    } catch (err) {
        console.error('Error loading questions:', err);
        container.innerHTML = '<div class="error-message">Error loading questions. Please try again later.</div>';
    }
}

// --- Interaction Handlers ---

function attachInteractionHandlers() {
    // 1. SBA Click Handlers (Option click)
    document.querySelectorAll('.sba-option').forEach(opt => {
        opt.addEventListener('click', handleSbaOptionClick);
    });

    // 2. Numeric Submit Handlers
    document.querySelectorAll('.numeric-submit-btn').forEach(btn => {
        btn.addEventListener('click', handleNumericSubmit);
    });

    // 3. MBA Submit Handlers
    document.querySelectorAll('.mba-submit-btn').forEach(btn => {
        btn.addEventListener('click', handleMbaSubmit);
    });

    // 4. EMQ Submit Handlers
    document.querySelectorAll('.emq-submit-btn').forEach(btn => {
        btn.addEventListener('click', handleEmqSubmit);
    });
}

function handleSbaOptionClick(e) {
    const optParams = e.currentTarget.dataset;
    const qIdx = parseInt(optParams.qIdx);
    const optIdx = parseInt(optParams.optIdx);

    const block = document.querySelector(`.question-block[data-q-idx="${qIdx}"]`);
    if (!block || block.classList.contains('answered')) return;

    const q = currentQuestions[qIdx];
    if (!q) return;

    block.classList.add('answered');

    // Visual feedback
    const options = block.querySelectorAll('.sba-option');
    options[optIdx].classList.add('selected');

    const correctIdx = q.correct;
    if (typeof correctIdx === 'number') {
        if (optIdx === correctIdx) {
            options[optIdx].classList.add('correct');
            options[optIdx].classList.remove('selected');
        } else {
            options[optIdx].classList.add('wrong');
            if (options[correctIdx]) options[correctIdx].classList.add('correct');
        }
    }

    revealAnswer(block);
}

function handleNumericSubmit(e) {
    const qIdx = parseInt(e.target.dataset.qIdx);
    const block = document.querySelector(`.question-block[data-q-idx="${qIdx}"]`);
    if (!block || block.classList.contains('answered')) return;

    const input = block.querySelector('input[type="number"]');
    const userVal = parseFloat(input.value);

    if (isNaN(userVal)) {
        alert('Please enter a valid number');
        return;
    }

    const q = currentQuestions[qIdx];
    block.classList.add('answered');
    e.target.disabled = true;
    input.disabled = true;

    const correct = q.correctAnswer;
    const tolerance = q.tolerance || 0;
    const isCorrect = Math.abs(userVal - correct) <= tolerance;

    if (isCorrect) {
        input.classList.add('correct-input'); // CSS class needed
        input.style.borderColor = '#4caf50';
        input.style.backgroundColor = '#e8f5e9';
    } else {
        input.classList.add('wrong-input');
        input.style.borderColor = '#f44336';
        input.style.backgroundColor = '#ffebee';
    }

    revealAnswer(block);
}

function handleMbaSubmit(e) {
    const qIdx = parseInt(e.target.dataset.qIdx);
    const block = document.querySelector(`.question-block[data-q-idx="${qIdx}"]`);
    if (!block || block.classList.contains('answered')) return;

    const checkboxes = block.querySelectorAll('input[type="checkbox"]');
    const selected = Array.from(checkboxes)
        .filter(cb => cb.checked)
        .map(cb => parseInt(cb.value));

    if (selected.length === 0) {
        alert('Please select at least one option.');
        return;
    }

    const q = currentQuestions[qIdx];
    block.classList.add('answered');
    e.target.disabled = true;
    checkboxes.forEach(cb => cb.disabled = true);

    const correctIndices = q.correct || [];

    checkboxes.forEach((cb, idx) => {
        const parent = cb.closest('.mba-option');
        if (correctIndices.includes(idx)) {
            parent.classList.add('correct');
            parent.style.backgroundColor = '#e8f5e9';
            parent.style.borderColor = '#4caf50';
        } else if (selected.includes(idx)) {
            parent.classList.add('wrong');
            parent.style.backgroundColor = '#ffebee';
            parent.style.borderColor = '#f44336';
        }
    });

    revealAnswer(block);
}

function handleEmqSubmit(e) {
    const qIdx = parseInt(e.target.dataset.qIdx);
    const block = document.querySelector(`.question-block[data-q-idx="${qIdx}"]`);
    if (!block || block.classList.contains('answered')) return;

    const selects = block.querySelectorAll('select');
    let allAnswered = true;
    selects.forEach(s => { if (!s.value) allAnswered = false; });

    if (!allAnswered) {
        alert('Please select an answer for all stems.');
        return;
    }

    const q = currentQuestions[qIdx];
    block.classList.add('answered');
    e.target.disabled = true;

    // Validate each stem
    q.stems.forEach((stem, sIdx) => {
        const select = selects[sIdx];
        const userAns = parseInt(select.value);
        const correctAns = stem.correct;

        select.disabled = true;

        if (userAns === correctAns) {
            select.style.borderColor = '#4caf50';
            select.style.backgroundColor = '#e8f5e9';
        } else {
            select.style.borderColor = '#f44336';
            select.style.backgroundColor = '#ffebee';
        }
    });

    revealAnswer(block); // This reveals the global answer/expl block? 
    // Actually EMQ usually has explanations per stem.
    // Let's reveal all the per-stem explanations.
    block.querySelectorAll('.emq-stem-explanation').forEach(el => el.style.display = 'block');
}


function revealAnswer(block) {
    const box = block.querySelector('.correct-answer-box');
    if (box) {
        box.style.display = 'block';
        box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}


// --- Data Normalization (Robust) ---

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
    // 1. Basic JSON Parsing
    q.options = safeParse(q.options, []);
    q.stems = safeParse(q.stems, []);

    // 2. Normalize correct_answer / correct
    if (q.type === 'numeric') {
        let rawCorrect = q.correct !== null ? q.correct : q.correct_answer;
        if (typeof rawCorrect === 'object' && rawCorrect !== null) {
            q.correctAnswer = parseFloat(rawCorrect.value || rawCorrect.answer || rawCorrect.correct || 0);
        } else {
            q.correctAnswer = parseFloat(rawCorrect) || 0;
        }
        q.tolerance = parseFloat(q.tolerance) || 0;
    } else if (q.type === 'mba') {
        // Ensure correct is an array
        if (!Array.isArray(q.correct)) {
            if (typeof q.correct === 'string') {
                if (q.correct.includes(',')) {
                    q.correct = q.correct.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
                } else {
                    const parsed = parseInt(q.correct);
                    q.correct = isNaN(parsed) ? [] : [parsed];
                }
            } else if (typeof q.correct === 'number') {
                q.correct = [q.correct];
            } else {
                q.correct = safeParse(q.correct_answer, []);
            }
        }
    } else {
        // SBA / EMQ
        if (typeof q.correct_answer === 'string') {
            const trimmed = q.correct_answer.trim();
            if (/^\d+$/.test(trimmed)) {
                q.correct = parseInt(trimmed, 10);
            } else if (/^[A-Ei]$/i.test(trimmed)) {
                const code = trimmed.toUpperCase().charCodeAt(0);
                q.correct = code - 65;
            } else {
                q.correct = safeParse(q.correct_answer, null);
            }
            // Fallback text match
            if ((q.correct === null || typeof q.correct !== 'number') && Array.isArray(q.options)) {
                const lowerCorrect = trimmed.toLowerCase();
                const matchIdx = q.options.findIndex(opt => opt.trim().toLowerCase() === lowerCorrect);
                if (matchIdx !== -1) q.correct = matchIdx;
            }
        } else {
            q.correct = q.correct_answer !== undefined ? q.correct_answer : null;
        }
    }

    // 3. Fallbacks
    q.stem = q.stem || 'No question text available.';
    q.explanation = q.explanation || 'No explanation available.';

    return q;
}


// --- Rendering ---

function renderQuestionBlock(q, index) {
    // Header
    const headerHtml = `
        <div class="q-header">
            <span>Question ${index + 1} (${q.type ? escapeHTML(q.type.toUpperCase()) : 'General'})</span>
            <span>${escapeHTML(formatQuestionCode(q))}</span>
        </div>
        <div class="q-stem">${sanitizeHTML(q.stem)}</div>
    `;

    // Content based on Type
    let customContent = '';
    let explanationHtml = `
        <div class="correct-answer-box" style="display:none;">
             <span class="correct-label">Correct: ${getCorrectLabel(q)}</span>
             <div class="explanation">${sanitizeHTML(q.explanation)}</div>
        </div>
    `;

    if (q.type === 'numeric') {
        customContent = `
            <div style="margin-bottom: 1rem;">
                <input type="number" step="any" class="numeric-input" placeholder="Enter your answer" 
                       style="padding: 8px; border: 1px solid #ccc; border-radius: 4px; width: 150px;">
                ${q.unit ? `<span style="margin-left: 5px; color: #666;">${escapeHTML(q.unit)}</span>` : ''}
            </div>
            <button class="numeric-submit-btn" data-q-idx="${index}" 
                    style="padding: 8px 16px; background: #1976d2; color: white; border: none; border-radius: 4px; cursor: pointer;">
                Check Answer
            </button>
        `;
    } else if (q.type === 'mba') {
        customContent = `
            <div class="mba-options" style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 1rem;">
                ${q.options.map((opt, i) => `
                    <label class="mba-option" style="display: block; padding: 8px; border: 1px solid #eee; border-radius: 4px; cursor: pointer;">
                        <input type="checkbox" value="${i}" style="margin-right: 8px;">
                        ${String.fromCharCode(65 + i)}. ${sanitizeHTML(opt)}
                    </label>
                `).join('')}
            </div>
            <button class="mba-submit-btn" data-q-idx="${index}" 
                    style="padding: 8px 16px; background: #1976d2; color: white; border: none; border-radius: 4px; cursor: pointer;">
                Check Answer
            </button>
        `;
    } else if (q.type === 'emq') {
        const stemsHtml = q.stems.map((stem, sIdx) => `
            <div style="margin-top: 1rem; padding-top: 1rem; border-top: 1px dashed #eee;">
                <div style="margin-bottom: 0.5rem; font-weight: 500;">${sanitizeHTML(stem.stem)}</div>
                <select style="width: 100%; max-width: 400px; padding: 8px; border: 1px solid #ccc; border-radius: 4px;">
                    <option value="">Select option...</option>
                    ${q.options.map((opt, i) => `<option value="${i}">${String.fromCharCode(65 + i)}. ${sanitizeHTML(opt)}</option>`).join('')}
                </select>
                <div class="emq-stem-explanation" style="display: none; margin-top: 0.5rem; padding: 10px; background: #e8f5e9; border: 1px solid #c8e6c9; border-radius: 4px;">
                    <strong>Correct: ${String.fromCharCode(65 + stem.correct)}. ${sanitizeHTML(q.options[stem.correct])}</strong><br>
                    ${sanitizeHTML(stem.explanation)}
                </div>
            </div>
        `).join('');

        customContent = `
            <div class="emq-options-list" style="margin-bottom: 1.5rem; padding: 10px; background: #f5f5f5; border-radius: 4px;">
                <strong>Options:</strong>
                <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 5px; margin-top: 5px; font-size: 0.9em;">
                    ${q.options.map((opt, i) => `<div><strong>${String.fromCharCode(65 + i)}.</strong> ${sanitizeHTML(opt)}</div>`).join('')}
                </div>
            </div>
            ${stemsHtml}
             <button class="emq-submit-btn" data-q-idx="${index}" 
                    style="margin-top: 1rem; padding: 8px 16px; background: #1976d2; color: white; border: none; border-radius: 4px; cursor: pointer;">
                Check All Answers
            </button>
        `;
        // EMQ has its own inline explanations, so we suppress the main one? 
        // Just reuse the main one for a generic message or hide it.
        explanationHtml = '';
    } else {
        // SBA (Default)
        customContent = `
            <div class="q-options">
                ${q.options.map((opt, i) => `
                    <div class="q-option sba-option" data-q-idx="${index}" data-opt-idx="${i}">
                        ${String.fromCharCode(65 + i)}. ${sanitizeHTML(opt)}
                    </div>
                `).join('')}
            </div>
        `;
    }

    return `
        <div class="question-block" data-q-idx="${index}">
            ${headerHtml}
            ${customContent}
            ${explanationHtml}
        </div>
    `;
}

function getCorrectLabel(q) {
    if (q.type === 'numeric') {
        return `${q.correctAnswer} ${escapeHTML(q.unit || '')} (±${q.tolerance})`;
    } else if (q.type === 'mba') {
        const indices = q.correct || [];
        return indices.map(i => String.fromCharCode(65 + i)).join(', ');
    } else if (q.type === 'sba') {
        const idx = q.correct;
        if (typeof idx === 'number' && q.options[idx]) {
            return `${String.fromCharCode(65 + idx)}. ${sanitizeHTML(q.options[idx])}`;
        }
    }
    return 'See explanation';
}
