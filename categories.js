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
            .select('Category, type');

        if (error) throw error;

        // aggregation: { topic: { total: X, answered: Y, flagged: Z } }
        const topics = {};

        // 2. Get user progress from localStorage
        const savedState = JSON.parse(localStorage.getItem("quizStateV2") || "{}");
        const answeredStates = savedState.questionStates || [];

        data.forEach((q, idx) => {
            // Filter by type if param exists
            if (typeParam && q.type !== typeParam) return;

            const topic = q.Category || 'General';
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

        const sortedTopics = Object.keys(topics).sort();

        if (sortedTopics.length === 0) {
            container.innerHTML = `<div style="text-align:center; padding: 2rem;">No ${typeParam ? typeParam.toUpperCase() + ' ' : ''}questions found.</div>`;
            return;
        }

        container.innerHTML = sortedTopics.map(topic => {
            const typeQuery = typeParam ? `&type=${typeParam}` : '';
            return `
                <a href="practice-mixed.html?topic=${encodeURIComponent(topic)}${typeQuery}" class="category-card">
                    <h3>${topic}</h3>
                </a>
            `;
        }).join('');

    } catch (err) {
        console.error('Error loading categories:', err);
        container.innerHTML = '<div style="text-align:center; padding: 2rem; color: #d32f2f;">Failed to load categories. Please try again.</div>';
    }
}

document.addEventListener('DOMContentLoaded', initCategories);
