import { supabase } from './supabase.js';

async function initCategories() {
    const container = document.getElementById('category-container');
    const params = new URLSearchParams(window.location.search);
    const typeParam = params.get('type'); // 'sba' or 'emq'

    // Update header if type is present
    if (typeParam) {
        const titleEl = document.querySelector('h2');
        const pEl = document.querySelector('section > p');
        if (titleEl) {
            titleEl.textContent = typeParam === 'sba' ? 'SBA Categories' :
                typeParam === 'emq' ? 'EMQ Categories' : 'Practice by Category';
        }
        if (pEl) {
            pEl.textContent = typeParam === 'sba' ? 'Master Single Best Answer questions by topic.' :
                typeParam === 'emq' ? 'Challenge yourself with Extended Matching Questions.' :
                    pEl.textContent;
        }
    }

    try {
        // 1. Fetch all questions
        // We select more fields because we might need to filter by type client-side 
        // (or we can do it in the query if we wanted, but client-side is fine for current scale)
        const { data, error } = await supabase
            .from('questions')
            .select('topic, type, flagged');

        if (error) throw error;

        // aggregation: { topic: { total: X, answered: Y, flagged: Z } }
        const topics = {};

        // 2. Get user progress from localStorage
        const savedState = JSON.parse(localStorage.getItem("quizStateV2") || "{}");
        const answeredStates = savedState.questionStates || [];

        data.forEach((q, idx) => {
            // Filter by type if param exists
            if (typeParam && q.type !== typeParam) return;

            const topic = q.topic || 'General';
            if (!topics[topic]) {
                topics[topic] = { total: 0, completed: 0, flagged: 0 };
            }
            topics[topic].total++;

            const state = answeredStates[idx];
            if (state && state.status !== 'not-attempted') {
                topics[topic].completed++;
            }
            if (state && state.flagged) {
                topics[topic].flagged++;
            }
        });

        const DOMAIN_MAPPING = {
            'Cardiology': 'Clinical Medicine',
            'Neurology': 'Clinical Medicine',
            'Respiratory': 'Clinical Medicine',
            'Endocrinology': 'Clinical Medicine',
            'Gastroenterology': 'Clinical Medicine',
            'Pharmacology': 'Clinical Medicine',
            'Laboratory Interpretation': 'Clinical Medicine',
            'Dermatology': 'Clinical Medicine',
            'Musculoskeletal': 'Clinical Medicine',

            'Paediatrics': 'Clinical Specialties',
            'Otolaryngology': 'Clinical Specialties',
            'Urology': 'Clinical Specialties',
            'Ophthalmology': 'Clinical Specialties',
            'Obstetrics & Gynaecology': 'Clinical Specialties',
            'Psychiatry': 'Clinical Specialties',

            'Administration': 'Practice Administration',
            'Statistics': 'Evidence Based Medicine',
            'Genetics': 'Medical Sciences',
            'Miscellaneous': 'Other'
        };

        const sortedTopics = Object.keys(topics).sort();

        if (sortedTopics.length === 0) {
            container.innerHTML = `<div style="text-align:center; padding: 2rem;">No ${typeParam ? typeParam.toUpperCase() + ' ' : ''}questions found.</div>`;
            return;
        }

        // Group topics by domain
        const grouped = {};
        sortedTopics.forEach(topic => {
            const domain = DOMAIN_MAPPING[topic] || 'Other';
            if (!grouped[domain]) grouped[domain] = [];
            grouped[domain].push(topic);
        });

        // Define order of domains
        const domainOrder = ['Clinical Medicine', 'Clinical Specialties', 'Medical Sciences', 'Evidence Based Medicine', 'Practice Administration', 'Other'];

        let html = '';

        domainOrder.forEach(domain => {
            if (grouped[domain] && grouped[domain].length > 0) {
                html += `
                    <div class="domain-section" style="width: 100%; margin-bottom: 3rem;">
                        <h3 style="color: #2563a6; border-bottom: 2px solid #e0e0e0; padding-bottom: 0.5rem; margin-bottom: 1.5rem; font-size: 1.5rem;">${domain}</h3>
                        <div class="category-grid">
                            ${grouped[domain].map(topic => {
                    const stats = topics[topic];
                    const typeQuery = typeParam ? `&type=${typeParam}` : '';
                    return `
                                    <a href="practice-mixed.html?topic=${encodeURIComponent(topic)}${typeQuery}" class="category-card">
                                        <h3>${topic}</h3>
                                        <div class="category-stats">
                                            <div class="stat-line"><span class="stat-complete">${stats.completed}</span> out of ${stats.total} complete</div>
                                            <div class="stat-line"><span class="stat-flagged">${stats.flagged}</span> flagged</div>
                                        </div>
                                    </a>
                                `;
                }).join('')}
                        </div>
                    </div>
                `;
            }
        });

        container.innerHTML = html;
        // Remove the main grid class since we are now holding multiple grids
        container.classList.remove('category-grid');

    } catch (err) {
        console.error('Error loading categories:', err);
        container.innerHTML = '<div style="text-align:center; padding: 2rem; color: #d32f2f;">Failed to load categories. Please try again.</div>';
    }
}

document.addEventListener('DOMContentLoaded', initCategories);
