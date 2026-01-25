import { supabase } from './supabase.js';

document.addEventListener('DOMContentLoaded', async () => {
    const params = new URLSearchParams(window.location.search);
    const topicId = params.get('topic_id');

    // Setup back links
    const backLink = document.getElementById('back-link');
    const backLinkBottom = document.getElementById('back-link-bottom');
    const targetUrl = topicId ? `study.html?topic_id=${topicId}` : 'study.html';

    if (backLink) backLink.href = targetUrl;
    if (backLinkBottom) backLinkBottom.href = targetUrl;

    if (!topicId) {
        document.getElementById('qa-content').innerHTML = '<div class="error-message">No topic specified.</div>';
        return;
    }

    await loadQuestions(topicId);
});

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

        container.innerHTML = questions.map((q, index) => renderQuestionBlock(q, index)).join('');

    } catch (err) {
        console.error('Error loading questions:', err);
        container.innerHTML = '<div class="error-message">Error loading questions. Please try again later.</div>';
    }
}

function renderQuestionBlock(q, index) {
    let optionsHtml = '';
    let correctText = '';

    // Handle SBA/EMQ options for display context
    if (q.type === 'sba' && q.options) {
        optionsHtml = `<div class="q-options">
            ${q.options.map((opt, i) => `<div class="q-option">${String.fromCharCode(65 + i)}. ${opt}</div>`).join('')}
        </div>`;
        correctText = `${String.fromCharCode(65 + q.correct)}. ${q.options[q.correct]}`;
    } else if (q.type === 'emq' && q.options) {
        optionsHtml = `<div class="q-options">
            <strong>Options:</strong><br>
            ${q.options.map((opt, i) => `<div class="q-option">${String.fromCharCode(65 + i)}. ${opt}</div>`).join('')}
        </div>`;
        // For EMQ, we might have multiple stems, but if this is the parent question structure:
        // usually EMQs are stored as one big question or stems are nested. 
        // Based on practice-mixed.js logic, q.stems exists for EMQ.
    }

    // Special rendering for EMQs which have stems
    if (q.type === 'emq' && q.stems) {
        const stemsHtml = q.stems.map((stem, sIdx) => {
            const cText = `${String.fromCharCode(65 + stem.correct)}. ${q.options[stem.correct]}`;
            return `
                <div style="margin-top: 1.5rem; padding-top: 1rem; border-top: 1px dashed #eee;">
                    <strong>Stem ${sIdx + 1}:</strong> ${stem.stem}
                    <div class="correct-answer-box">
                        <span class="correct-label">Correct Answer: ${cText}</span>
                        <div class="explanation">${stem.explanation}</div>
                    </div>
                </div>
             `;
        }).join('');

        return `
            <div class="question-block">
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
        <div class="question-block">
            <div class="q-header">
                <span>Question ${index + 1} (${q.type ? q.type.toUpperCase() : 'General'})</span>
                <span>${q['Question Code'] || ''}</span>
            </div>
            <div class="q-stem">${q.stem}</div>
            ${optionsHtml}
            
            <div class="correct-answer-box">
                <span class="correct-label">Correct Answer: ${correctText || 'See Explanation'}</span>
                <div class="explanation">${q.explanation || 'No explanation available.'}</div>
            </div>
        </div>
    `;
}
