import { supabase } from './supabase.js';

document.addEventListener('DOMContentLoaded', async () => {
    const params = new URLSearchParams(window.location.search);
    const topicId = params.get('topic_id');

    if (topicId) {
        await loadRevisionGuide(topicId);
    } else {
        await loadAllGuides();
    }
});

async function loadRevisionGuide(topicId) {
    const staticContent = document.getElementById('static-content');
    const dynamicContent = document.getElementById('dynamic-content');
    const pageTitle = document.querySelector('h2');
    const pageDesc = document.querySelector('section > p');

    // Safe toggle helper
    const toggleView = (showDynamic) => {
        if (staticContent) staticContent.style.display = showDynamic ? 'none' : 'block';
        if (dynamicContent) dynamicContent.style.display = showDynamic ? 'block' : 'none';
        if (pageTitle) pageTitle.style.display = showDynamic ? 'none' : 'block';
        if (pageDesc) pageDesc.style.display = showDynamic ? 'none' : 'block';
    };

    toggleView(true);

    if (!dynamicContent) return;

    dynamicContent.innerHTML = '<div class="loading-container">Loading revision guide...</div>';

    try {
        const { data, error } = await supabase
            .from('revision_guides')
            .select('*')
            .eq('topic_id', topicId)
            .single();

        if (error) throw error;

        if (!data) {
            dynamicContent.innerHTML = `
                <div class="error-message">
                    <h3>Guide Not Found</h3>
                    <p>Sorry, we couldn't find the requested revision guide.</p>
                    <a href="study.html" class="back-link">&larr; Back to Study Resources</a>
                </div>`;
            return;
        }

        renderGuide(data, dynamicContent);

    } catch (err) {
        console.error('Error loading guide:', err);
        dynamicContent.innerHTML = `
            <div class="error-message">
                <h3>Error Loading Guide</h3>
                <p>Unable to load content. Please try again later.</p>
                <a href="study.html" class="back-link">&larr; Back to Study Resources</a>
            </div>`;
    }
}

function renderGuide(data, container) {
    // Fallback for content fields
    const title = data.title || 'Revision Guide';
    const content = data.content || data.html_content || data.body || '<p>No content available.</p>';
    const lastUpdated = data.updated_at ? new Date(data.updated_at).toLocaleDateString() : '';

    container.innerHTML = `
        <div class="guide-header">
            <a href="study.html" class="back-link">&larr; Back to Study Resources</a>
            <h1 class="guide-title">${title}</h1>
            ${lastUpdated ? `<div class="guide-meta">Last updated: ${lastUpdated}</div>` : ''}
        </div>
        <div class="guide-content">
            ${content}
        </div>
        <div class="guide-actions" style="margin-top: 3rem; text-align: right; border-top: 1px solid #eee; padding-top: 1.5rem;">
            <a href="questions-answer-only.html?topic_id=${data.topic_id}" class="cta-btn" style="display: inline-flex; align-items: center; gap: 0.5rem; text-decoration: none; background: #2e7d32; color: white; padding: 0.8rem 1.5rem; border-radius: 6px; font-weight: 600; transition: background 0.2s;">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="9 11 12 14 22 4"></polyline>
                    <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path>
                </svg>
                See Linked Questions & Answers
            </a>
        </div>
    `;
}

async function loadAllGuides() {
    const container = document.getElementById('guides-list');
    if (!container) return;

    try {
        const { data, error } = await supabase
            .from('revision_guides')
            .select('*')
            .order('title');

        if (error) throw error;

        if (!data || data.length === 0) {
            container.innerHTML = '<div style="grid-column: 1/-1; color: #666; font-style: italic;">No revision guides available yet. Check back soon!</div>';
            return;
        }

        container.innerHTML = data.map(guide => `
            <a href="study.html?topic_id=${guide.topic_id}" class="resource-card" style="text-decoration: none; color: inherit; display: block;">
                <h3>${guide.title}</h3>
                <p>${guide.summary || 'Click to read full guide.'}</p>
            </a>
        `).join('');

    } catch (err) {
        console.error('Error loading guides list:', err);
        container.innerHTML = '<div style="color: #d32f2f;">Failed to load guides. Please try reloading the page.</div>';
    }
}
