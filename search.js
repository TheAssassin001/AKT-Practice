import { supabase } from './supabase.js';
import { sanitizeHTML, escapeHTML, stripHTML, formatQuestionCode } from './utils.js';

let allQuestionsCache = [];
let currentResults = [];
let displayCount = 0;
const PAGE_SIZE = 50;

document.addEventListener('DOMContentLoaded', async () => {
    const statusMsg = document.getElementById('status-message');
    const searchInput = document.getElementById('global-search-input');

    try {
        // 1. Fetch ALL questions on load
        statusMsg.innerHTML = '<div class="loading-spinner"></div><p>Indexing question bank...</p>';

        const { data, error } = await supabase
            .from('questions')
            .select('*');

        if (error) throw error;

        allQuestionsCache = data || [];
        statusMsg.innerText = `Ready to search ${allQuestionsCache.length} questions.`;

        // 2. Enable Search
        searchInput.disabled = false;
        searchInput.focus();

        searchInput.addEventListener('input', handleSearch);

    } catch (err) {
        console.error('Error loading questions:', err);
        statusMsg.innerHTML = '<div style="color: #d32f2f;">Failed to load question bank. Please refresh.</div>';
    }
});

function handleSearch(e) {
    const query = e.target.value.toLowerCase().trim();
    const container = document.getElementById('results-container');
    const statusMsg = document.getElementById('status-message');
    const loadMoreBtn = document.getElementById('load-more-trigger');

    if (!query) {
        container.innerHTML = '';
        statusMsg.style.display = 'block';
        statusMsg.innerText = `Ready to search ${allQuestionsCache.length} questions.`;
        loadMoreBtn.style.display = 'none';
        return;
    }

    statusMsg.style.display = 'none';

    // Robust Filtering Logic
    currentResults = allQuestionsCache.filter(q => {
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

    if (currentResults.length === 0) {
        container.innerHTML = '';
        statusMsg.style.display = 'block';
        statusMsg.innerHTML = `No matches found for "<strong>${escapeHTML(e.target.value)}</strong>"`;
        loadMoreBtn.style.display = 'none';
        return;
    }

    // Reset Pagination
    displayCount = 0;
    container.innerHTML = '';
    renderBatch();
}

function renderBatch() {
    const container = document.getElementById('results-container');
    const loadMoreBtn = document.getElementById('load-more-trigger');
    const btn = loadMoreBtn.querySelector('button');

    const nextBatch = currentResults.slice(displayCount, displayCount + PAGE_SIZE);

    if (nextBatch.length === 0) return;

    const html = nextBatch.map(q => {
        const type = q.type || 'unknown';
        const category = q.Category || 'General';
        const code = formatQuestionCode(q);

        // Snippet
        let stemSnippet = typeof q.stem === 'string' ? q.stem : 'Question Text';
        stemSnippet = stripHTML(stemSnippet); // Use utility function to strip HTML
        if (stemSnippet.length > 150) stemSnippet = stemSnippet.substring(0, 150) + '...';

        return `
            <a href="practice-mixed.html?mode=practice&startId=${q.id}&topic=${encodeURIComponent(category)}" 
               class="result-card ${escapeHTML(type)}">
                <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 0.5rem;">
                    <span style="font-weight: 700; color: #1565c0;">${escapeHTML(code)}</span>
                    <span style="font-size: 0.75rem; text-transform: uppercase; background: #f5f5f5; padding: 2px 6px; border-radius: 4px; color: #666;">${escapeHTML(type)}</span>
                </div>
                <h4 style="margin: 0 0 0.5rem 0; color: #333; font-size: 1rem;">${escapeHTML(category)}</h4>
                <p style="margin: 0; color: #666; font-size: 0.9rem; line-height: 1.5;">${escapeHTML(stemSnippet)}</p>
            </a>
        `;
    }).join('');

    container.innerHTML += html;
    displayCount += nextBatch.length;

    // Show/Hide Load More
    if (displayCount < currentResults.length) {
        loadMoreBtn.style.display = 'block';
        btn.onclick = renderBatch;
    } else {
        loadMoreBtn.style.display = 'none';
        // Add "End of results" marker if we have many results
        if (currentResults.length > 20) {
            container.innerHTML += '<div style="grid-column: 1/-1; text-align: center; color: #aaa; margin-top: 1rem;">End of results</div>';
        }
    }
}
