import { supabase } from './supabase.js';
import { sanitizeHTML, escapeHTML } from './utils.js';

async function initCommentsPage() {
    const container = document.getElementById('comments-container');
    const noComments = document.getElementById('no-comments');

    try {
        // 1. Fetch unique question_ids from comments table
        // Since Supabase doesn't support SELECT DISTINCT ON easily in JS client without RPC,
        // we'll fetch all comments and post-process. Not efficient for huge data, but fine for now.
        const { data: comments, error: commentError } = await supabase
            .from('question_comments')
            .select('*')
            .order('created_at', { ascending: false });

        if (commentError) throw commentError;

        if (!comments || comments.length === 0) {
            container.style.display = 'none';
            noComments.style.display = 'block';
            return;
        }

        // 2. Group by question_id to get counts and latest comment
        const questionMap = {};
        comments.forEach(c => {
            if (!questionMap[c.question_id]) {
                questionMap[c.question_id] = {
                    latestComment: c,
                    count: 0
                };
            }
            questionMap[c.question_id].count++;
        });

        // 3. Fetch Question Details for these IDs
        const qIds = Object.keys(questionMap);
        const { data: questions, error: qError } = await supabase
            .from('questions')
            .select('id, stem, "Question Code", "Display Code"')
            .in('id', qIds);

        if (qError) throw qError;

        // 4. Render Cards
        container.innerHTML = ''; // Clear loading
        container.className = 'comments-page-grid';

        if (!questions || questions.length === 0) {
            // Should not happen if referential integrity holds
            container.style.display = 'none';
            noComments.style.display = 'block';
            return;
        }

        questions.forEach(q => {
            const stats = questionMap[q.id];
            const latest = stats.latestComment;

            // Format Date
            const date = new Date(latest.created_at).toLocaleDateString();

            const card = document.createElement('a');
            card.href = `practice-mixed.html?mode=practice&startId=${q.id}`; // Add startId logic to practice-mixed.js!
            card.className = 'comment-summary-card';
            // Show BOTH Display Code and Question Code (e.g., "CR 1014")
            const displayCode = q['Display Code'] || '';
            const questionCode = q['Question Code'] || '';
            const codeText = displayCode && questionCode ? `${displayCode} ${questionCode}` : (displayCode || questionCode || 'Q-' + q.id);

            card.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <span style="font-weight: 700; color: #2563a6;">${escapeHTML(codeText)}</span>
                    <span class="comment-count-badge">${stats.count} comment${stats.count !== 1 ? 's' : ''}</span>
                </div>
                
                <div class="question-snippet">
                    ${sanitizeHTML(q.stem || '(No question text available)')}
                </div>

                <div class="latest-comment">
                    <div style="font-weight: 600; font-size: 0.75rem; margin-bottom: 2px;">
                        ${escapeHTML(latest.user_name || 'Anonymous')} • ${escapeHTML(date)}
                    </div>
                    "${escapeHTML(latest.comment_text)}"
                </div>
            `;
            container.appendChild(card);
        });

    } catch (err) {
        console.error('Error loading comments page:', err);
        container.innerHTML = '<div style="color: red; text-align: center;">Failed to load discussions. Please try again later.</div>';
    }
}

document.addEventListener('DOMContentLoaded', initCommentsPage);
