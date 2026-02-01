import { supabase } from './supabase.js';

async function initCategories() {
    const container = document.getElementById('category-container');
    const urlParams = new URLSearchParams(window.location.search);
    const typeParam = urlParams.get('type'); // 'sba', 'emq', 'mixed'

    try {
        // 1. Fetch all questions
        // We fetch minimal data to calculate counts on the client
        // (or we can do it in the query if we wanted, but client-side is fine for current scale)
        const { data, error } = await supabase
            .from('questions')
            .select('*'); // Initial load: fetch all columns for search capability

        if (error) throw error;

        // Group by Topic
        // aggregation: { topic: { total: X, answered: Y, flagged: Z } }
        const topics = {};

        // 2. Get user progress
        const questionHistory = JSON.parse(localStorage.getItem("akt-question-history") || "{}");

        // Use only the practice flag key as requested
        const practiceFlags = JSON.parse(localStorage.getItem("akt-flagged-questions-practice") || "{}");

        data.forEach((q) => {
            // Filter by type if param exists
            if (typeParam && q.type !== typeParam) return;

            const topic = q.Category || 'General';
            if (!topics[topic]) {
                topics[topic] = { total: 0, completed: 0, practiceFlagged: 0 };
            }
            topics[topic].total++;

            // Check history
            if (questionHistory[q.id] && questionHistory[q.id].status !== 'not-attempted') {
                topics[topic].completed++;
            }

            // Check flags
            const qIdStr = String(q.id);
            if (practiceFlags[qIdStr]) {
                topics[topic].practiceFlagged++;
            }
        });

        const sortedTopics = Object.keys(topics).sort();

        if (sortedTopics.length === 0) {
            container.innerHTML = `<div style="text-align:center; padding: 2rem;">No ${typeParam ? typeParam.toUpperCase() + ' ' : ''}questions found.</div>`;
            return;
        }

        container.innerHTML = sortedTopics.map(topic => {
            const typeQuery = typeParam ? `&type=${typeParam}` : '';
            const t = topics[topic];
            // Calculation exactly as requested: completed / total * 100
            const percent = t.total > 0 ? Math.round((t.completed / t.total) * 100) : 0;

            return `
                <div style="position: relative;">
                    <a href="practice-mixed.html?topic=${encodeURIComponent(topic)}${typeQuery}" class="category-card">
                        <div style="width:100%">
                            <h3>${topic}</h3>
                            
                            <div class="progress-section" style="margin-top: 1rem; margin-bottom:0.8rem;">
                                <div style="background:#e9ecef; height:8px; border-radius:4px; overflow:hidden;">
                                    <div style="background:#4caf50; width:${percent}%; height:100%; transition: width 0.5s ease-out;"></div>
                                </div>
                                <div style="text-align:right; font-size:0.85rem; color:#666; margin-top:0.3rem; font-weight:600;">
                                    ${percent}%
                                </div>
                            </div>

                            <div style="font-size:0.9rem; color:#555; display:flex; flex-direction:column; gap:0.3rem;">
                                <div>${t.completed} questions out of ${t.total} completed</div>
                                
                                <div style="display:flex; flex-wrap:wrap; gap:0.5rem; margin-top:0.2rem;">
                                    ${t.practiceFlagged > 0 ? `
                                    <div style="color:#d32f2f; font-weight:600; font-size:0.85rem; display:flex; align-items:center; gap:4px; background:#ffebee; padding:2px 8px; border-radius:12px;">
                                        <span style="font-size:1.1em; line-height:1;">&#9873;</span> ${t.practiceFlagged} Practice Flags
                                    </div>` : ''}
                                </div>
                            </div>
                        </div>
                    </a>
                    ${t.completed > 0 ? `
                    <button class="reset-btn" data-topic="${topic}" title="Clear progress for this category">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        </svg>
                        Reset
                    </button>` : ''}
                </div>
            `;
        }).join('');

        // Attach event listeners for reset buttons
        container.querySelectorAll('.reset-btn').forEach(btn => {
            btn.onclick = async (e) => {
                e.preventDefault();
                e.stopPropagation();
                const topic = btn.dataset.topic;

                if (confirm(`Are you sure you want to clear your progress for "${topic}"? This cannot be undone.`)) {
                    const questionHistory = JSON.parse(localStorage.getItem("akt-question-history") || "{}");

                    // Filter data for this topic
                    const topicQuestionIds = data
                        .filter(q => (q.Category || 'General') === topic)
                        .map(q => String(q.id));

                    // Remove from history
                    topicQuestionIds.forEach(id => {
                        delete questionHistory[id];
                    });

                    localStorage.setItem("akt-question-history", JSON.stringify(questionHistory));

                    // Reset saved test session if it matches this category
                    const quizStateRaw = localStorage.getItem("quizStateV3");
                    if (quizStateRaw) {
                        try {
                            const quizState = JSON.parse(quizStateRaw);
                            if (quizState.selectedCategory === topic) {
                                localStorage.removeItem("quizStateV3");
                                console.log(`Cleared saved test session for "${topic}"`);
                            }
                        } catch (e) {
                            console.error('Error parsing quiz state during reset:', e);
                        }
                    }

                    // Re-initialize view
                    initCategories();
                }
            };
        });



        // 3. Setup Search Handler (At bottom of page)
        setupQuestionSearch(data);

    } catch (err) {
        console.error('Error loading categories:', err);
        container.innerHTML = '<div style="color: #d32f2f;">Failed to load categories. Please refresh the page.</div>';
    }
}

function setupQuestionSearch(allQuestions) {
    const searchInput = document.getElementById('question-search');
    const resultsContainer = document.getElementById('search-results');
    // Note: We do NOT hide category-container anymore, as requested search is at bottom.
    // We strictly show results in the results container.

    if (!searchInput || !resultsContainer) return;

    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase().trim();

        if (!query) {
            resultsContainer.style.display = 'none';
            resultsContainer.innerHTML = '';
            return;
        }

        resultsContainer.style.display = 'grid';

        // Filter Logic (Robust)
        const filtered = allQuestions.filter(q => {
            // 1. Code Match
            const qCode = String(q['Question Code'] || '').toLowerCase();
            const dCode = String(q['Display Code'] || '').toLowerCase();
            const idCode = String(q.id).toLowerCase();

            if (qCode.includes(query) || dCode.includes(query) || idCode === query || ('q' + idCode) === query) return true;

            // 2. Stem/Body Match
            const stemText = typeof q.stem === 'string' ? q.stem.toLowerCase() : JSON.stringify(q.stem || '').toLowerCase();
            if (stemText.includes(query)) return true;

            // 3. Options Match
            const optionsText = typeof q.options === 'string' ? q.options.toLowerCase() : JSON.stringify(q.options || '').toLowerCase();
            if (optionsText.includes(query)) return true;

            return false;
        });

        if (filtered.length === 0) {
            resultsContainer.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: #666; padding: 2rem;">No questions found matching "${e.target.value}".</div>`;
            return;
        }

        renderSearchResults(filtered, resultsContainer);
    });
}

function renderSearchResults(questions, container) {
    const displayLimit = 50;
    const subset = questions.slice(0, displayLimit);

    container.innerHTML = subset.map(q => {
        let stemSnippet = typeof q.stem === 'string' ? q.stem : 'Question Text';
        stemSnippet = stemSnippet.replace(/<[^>]*>?/gm, '');
        if (stemSnippet.length > 100) stemSnippet = stemSnippet.substring(0, 100) + '...';

        const code = q['Question Code'] || q['Display Code'] || `Q${q.id}`;
        const category = q.Category || 'General';

        return `
            <a href="practice-mixed.html?mode=practice&startId=${q.id}&topic=${encodeURIComponent(category)}" 
               class="category-card" style="border-left-color: #ff9800; min-height: auto;">
                <div style="width:100%">
                    <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:0.5rem;">
                        <span style="font-weight:700; color:#e65100; font-size:0.9rem;">${code}</span>
                        <span style="font-size:0.8rem; background:#f5f5f5; padding:2px 6px; border-radius:4px; color:#666;">${q.type ? q.type.toUpperCase() : 'Q'}</span>
                    </div>
                    
                    <h4 style="margin: 0 0 0.5rem 0; font-size: 1rem; color: #333;">${category}</h4>
                    <p style="font-size: 0.9rem; color: #555; margin: 0; line-height: 1.4;">${stemSnippet}</p>
                </div>
            </a>
        `;
    }).join('');

    if (questions.length > displayLimit) {
        container.innerHTML += `
            <div style="grid-column: 1/-1; text-align: center; margin-top: 1rem; color: #666;">
                And ${questions.length - displayLimit} more matches. Refine your search.
            </div>
        `;
    }
}

document.addEventListener('DOMContentLoaded', initCategories);

// Also handle browser back/forward button navigation
window.addEventListener('pageshow', function (event) {
    // If page was restored from cache, reinitialize
    if (event.persisted) {
        initCategories();
    }
});
