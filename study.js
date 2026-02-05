import { supabase } from './supabase.js';

let allRevisionGuides = []; // Global storage for filtering

document.addEventListener('DOMContentLoaded', async () => {
    const params = new URLSearchParams(window.location.search);
    const guideId = params.get('guide_id');
    const topicId = params.get('topic_id');

    // Add "Back to Ongoing Test" button if there's an active test
    const hasOngoingTest = localStorage.getItem('quizStateV3');
    if (hasOngoingTest) {
        // Find a good place to insert the button (after the page header)
        const section = document.querySelector('main section');
        if (section) {
            const backButton = document.createElement('div');
            backButton.style.cssText = 'text-align: center; margin: 1rem 0; padding: 1rem; background: #e3f2fd; border-radius: 8px;';
            backButton.innerHTML = `
                <a href="practice-mixed.html" style="color: #1976d2; font-weight: 600; text-decoration: none; display: inline-flex; align-items: center; gap: 0.5rem;">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M19 12H5M12 19l-7-7 7-7"/>
                    </svg>
                    Back to Ongoing Test
                </a>
            `;
            section.insertBefore(backButton, section.firstChild);
        }
    }

    if (guideId) {
        // Direct guide navigation - load specific guide by ID
        await loadSpecificGuide(guideId);
    } else if (topicId) {
        // Topic navigation - may show multiple guides
        await loadRevisionGuide(topicId);
    } else {
        // Default - show all guides
        await loadAllGuides();
        setupSearchHandler();
    }
});

function setupSearchHandler() {
    const searchInput = document.getElementById('guide-search');
    if (!searchInput) return;

    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase().trim();
        const filtered = allRevisionGuides.filter(guide => {
            const titleMatch = guide.title.toLowerCase().includes(query);
            const summaryMatch = guide.summary && guide.summary.toLowerCase().includes(query);

            // Check content fields for full-text search
            const content = (guide.content || guide.html_content || guide.body || '').toLowerCase();
            const contentMatch = content.includes(query);

            return titleMatch || summaryMatch || contentMatch;
        });
        renderGuidesToGrid(filtered);
    });
}

async function loadSpecificGuide(guideId) {
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
        // Fetch specific guide by ID
        const { data, error } = await supabase
            .from('revision_guides')
            .select('*')
            .eq('id', guideId)
            .single();

        if (error) throw error;

        if (!data) {
            dynamicContent.innerHTML = `
                <div style="padding: 3rem 2rem; text-align: center; background: #fff3cd; border: 1px solid #ffc107; border-radius: 8px;">
                    <h3 style="color: #856404; margin-top: 0;">Guide Not Found</h3>
                    <p style="color: #856404;">Sorry, we couldn't find the requested revision guide. It may have been removed or the link is incorrect.</p>
                    <a href="study.html" class="back-link" style="display: inline-block; margin-top: 1rem; color: #1976d2; text-decoration: none; font-weight: 600;">&larr; Back to Study Resources</a>
                </div>`;
            return;
        }

        renderGuide(data, dynamicContent);

    } catch (err) {
        console.error('Error loading specific guide:', err);
        const errorMessage = err.message || 'Unknown error';
        const isPermissionError = errorMessage.includes('permission') || err.code === 'PGRST301';

        dynamicContent.innerHTML = `
            <div style="padding: 3rem 2rem; text-align: center; background: ${isPermissionError ? '#fff3cd' : '#f8d7da'}; border: 1px solid ${isPermissionError ? '#ffc107' : '#f5c6cb'}; border-radius: 8px;">
                <h3 style="color: ${isPermissionError ? '#856404' : '#721c24'}; margin-top: 0;">${isPermissionError ? 'Access Configuration Required' : 'Error Loading Guide'}</h3>
                <p style="color: ${isPermissionError ? '#856404' : '#721c24'};">
                    ${isPermissionError
                ? 'The revision guides feature requires permission updates in the database.'
                : 'Unable to load content. Please try again later.'}
                </p>
                <p style="color: ${isPermissionError ? '#856404' : '#721c24'}; font-size: 0.85rem; font-family: monospace; margin-top: 1rem;">${errorMessage}</p>
                <a href="study.html" class="back-link" style="display: inline-block; margin-top: 1rem; color: #1976d2; text-decoration: none; font-weight: 600;">&larr; Back to Study Resources</a>
            </div>`;
    }
}


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
        // Fetch linked guides via junction table
        let { data, error } = await supabase
            .from('topic_revision_guides')
            .select('revision_guides (*)')
            .eq('topic_id', topicId);

        // Fallback: If no junction data, try direct fetch
        if (!error && (!data || data.length === 0)) {
            const directRes = await supabase
                .from('revision_guides')
                .select('*')
                .eq('topic_id', topicId);

            if (!directRes.error && directRes.data && directRes.data.length > 0) {
                // Format to match expected structure or just use directly
                // We need to normalize for the next step, so let's wrap it to look like junction result
                // OR just handle it in the normalization step below
                data = directRes.data.map(g => ({ revision_guides: g }));
            }
        }

        if (error) throw error;

        // Flatten the result (array of objects containing revision_guides)
        // Filter out any null entries just in case
        const guides = (data || [])
            .map(row => row.revision_guides)
            .filter(g => g !== null);

        if (!guides || guides.length === 0) {
            dynamicContent.innerHTML = `
                <div style="padding: 3rem 2rem; text-align: center; background: #e3f2fd; border: 1px solid #90caf9; border-radius: 8px;">
                    <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#1976d2" stroke-width="1.5" style="margin-bottom: 1rem;">
                        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
                        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
                    </svg>
                    <h3 style="color: #1565c0; margin: 0 0 0.5rem 0;">No Guides Found for This Topic</h3>
                    <p style="color: #1976d2; margin: 0;">Revision guides for this topic are being prepared and will be available soon.</p>
                    <a href="study.html" class="back-link" style="display: inline-block; margin-top: 1.5rem; color: #1976d2; text-decoration: none; font-weight: 600;">&larr; Back to Study Resources</a>
                </div>`;
            return;
        }

        if (guides.length === 1) {
            // Single guide: Render as before
            renderGuide(guides[0], dynamicContent);
        } else {
            // Multiple guides: Render a list selection
            renderGuideList(guides, dynamicContent);
        }

    } catch (err) {
        console.error('Error loading guide:', err);
        const errorMessage = err.message || 'Unknown error';
        const isPermissionError = errorMessage.includes('permission') || err.code === 'PGRST301';

        dynamicContent.innerHTML = `
            <div style="padding: 3rem 2rem; text-align: center; background: ${isPermissionError ? '#fff3cd' : '#f8d7da'}; border: 1px solid ${isPermissionError ? '#ffc107' : '#f5c6cb'}; border-radius: 8px;">
                <h3 style="color: ${isPermissionError ? '#856404' : '#721c24'}; margin-top: 0;">${isPermissionError ? 'Access Configuration Required' : 'Error Loading Guide'}</h3>
                <p style="color: ${isPermissionError ? '#856404' : '#721c24'};">
                    ${isPermissionError
                ? 'The revision guides feature requires permission updates in the database.'
                : 'Unable to load content. Please try again later.'}
                </p>
                <p style="color: ${isPermissionError ? '#856404' : '#721c24'}; font-size: 0.85rem; font-family: monospace; margin-top: 1rem;">${errorMessage}</p>
                <a href="study.html" class="back-link" style="display: inline-block; margin-top: 1rem; color: #1976d2; text-decoration: none; font-weight: 600;">&larr; Back to Study Resources</a>
            </div>`;
    }
}

function renderGuideList(guides, container) {
    container.innerHTML = `
        <div class="guide-header">
            <a href="study.html" class="back-link">&larr; Back to Study Resources</a>
            <h1 class="guide-title">Select a Guide</h1>
            <p style="color: #666; margin-top: 0.5rem;">Multiple guides found for this topic.</p>
        </div>
        <div class="guides-grid" style="display: grid; gap: 1rem; margin-top: 2rem;">
            ${guides.map((guide, idx) => `
                <div class="resource-card guide-choice" 
                     data-idx="${idx}"
                     style="cursor: pointer; padding: 1.5rem; border: 1px solid #e0e0e0; border-radius: 8px; transition: all 0.2s;">
                    <h3 style="margin: 0 0 0.5rem 0; color: #1565c0;">${guide.title || 'Revision Guide ' + (idx + 1)}</h3>
                    <p style="margin: 0; color: #555; font-size: 0.95rem;">${guide.summary || 'Click to read full guide.'}</p>
                </div>
            `).join('')}
        </div>
    `;

    // Add click handlers to render specific guide
    container.querySelectorAll('.guide-choice').forEach(card => {
        card.onclick = () => {
            const idx = card.dataset.idx;
            renderGuide(guides[idx], container);
            window.scrollTo(0, 0);
        };
    });
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

        if (error) {
            // Distinguish between different error types
            console.error('Error loading guides list:', error);

            // Check for common error scenarios
            if (error.code === '42P01') {
                // Table doesn't exist
                container.innerHTML = `
                    <div style="grid-column: 1/-1; padding: 2rem; text-align: center; background: #fff3cd; border: 1px solid #ffc107; border-radius: 8px;">
                        <h3 style="color: #856404; margin-top: 0;">Configuration Required</h3>
                        <p style="color: #856404;">The revision guides table hasn't been set up yet in the database.</p>
                        <p style="color: #856404; font-size: 0.9rem;">Please contact the administrator to configure this feature.</p>
                    </div>
                `;
            } else if (error.code === 'PGRST301' || error.message.includes('permission')) {
                // Permission/RLS issue
                container.innerHTML = `
                    <div style="grid-column: 1/-1; padding: 2rem; text-align: center; background: #fff3cd; border: 1px solid #ffc107; border-radius: 8px;">
                        <h3 style="color: #856404; margin-top: 0;">Access Configuration Required</h3>
                        <p style="color: #856404;">The revision guides feature requires permission updates in the database.</p>
                        <p style="color: #856404; font-size: 0.9rem;">Please contact the administrator to enable anonymous read access.</p>
                    </div>
                `;
            } else {
                // Generic error
                container.innerHTML = `
                    <div style="grid-column: 1/-1; padding: 2rem; text-align: center; background: #f8d7da; border: 1px solid #f5c6cb; border-radius: 8px;">
                        <h3 style="color: #721c24; margin-top: 0;">Error Loading Guides</h3>
                        <p style="color: #721c24;">Failed to load revision guides. Please try reloading the page.</p>
                        <p style="color: #721c24; font-size: 0.85rem; font-family: monospace;">${error.message}</p>
                    </div>
                `;
            }
            return;
        }

        allRevisionGuides = data || [];

        // Handle empty state
        if (allRevisionGuides.length === 0) {
            container.innerHTML = `
                <div style="grid-column: 1/-1; padding: 3rem 2rem; text-align: center; background: #e3f2fd; border: 1px solid #90caf9; border-radius: 8px;">
                    <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#1976d2" stroke-width="1.5" style="margin-bottom: 1rem;">
                        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
                        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
                    </svg>
                    <h3 style="color: #1565c0; margin: 0 0 0.5rem 0;">No Revision Guides Available Yet</h3>
                    <p style="color: #1976d2; margin: 0;">Revision guides are being prepared and will be available soon.</p>
                    <p style="color: #1976d2; font-size: 0.9rem; margin-top: 1rem;">In the meantime, try practicing with our question banks!</p>
                </div>
            `;
            return;
        }

        renderGuidesToGrid(allRevisionGuides);

    } catch (err) {
        console.error('Unexpected error loading guides list:', err);
        container.innerHTML = `
            <div style="grid-column: 1/-1; padding: 2rem; text-align: center; background: #f8d7da; border: 1px solid #f5c6cb; border-radius: 8px;">
                <h3 style="color: #721c24; margin-top: 0;">Unexpected Error</h3>
                <p style="color: #721c24;">An unexpected error occurred. Please try reloading the page.</p>
                <p style="color: #721c24; font-size: 0.85rem; font-family: monospace;">${err.message}</p>
            </div>
        `;
    }
}

function renderGuidesToGrid(guides) {
    const container = document.getElementById('guides-list');
    if (!container) return;

    if (!guides || guides.length === 0) {
        container.innerHTML = '<div style="grid-column: 1/-1; color: #666; font-style: italic; text-align: center; padding: 2rem;">No matching guides found.</div>';
        return;
    }

    container.innerHTML = guides.map(guide => `
        <a href="study.html?guide_id=${guide.id}" class="resource-card" style="text-decoration: none; color: inherit; display: block;">
            <h3>${guide.title}</h3>
            <p>${guide.summary || 'Click to read full guide.'}</p>
        </a>
    `).join('');
}
