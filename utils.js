/**
 * Escapes HTML special characters to prevent XSS when rendering plain text.
 * @param {string} text - The text to escape.
 * @returns {string} - The escaped text.
 */
export function escapeHTML(text) {
    if (typeof text !== 'string') return String(text || '');
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Sanitizes an HTML string, allowing only a safe subset of tags and removing all attributes.
 * Useful for rendering content that may contain formatting (like question stems or explanations).
 * @param {string} html - The HTML string to sanitize.
 * @returns {string} - The sanitized HTML string.
 */
export function sanitizeHTML(html) {
    if (typeof html !== 'string') return String(html || '');

    // 1. First, strip out all <script>, <style>, <iframe>, <object>, <embed>, <applet> tags and their contents
    let sanitized = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    sanitized = sanitized.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');

    // 2. Create a temporary element to use the DOM's native parsing
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = sanitized;

    // 3. Define allowed tags
    const allowedTags = ['B', 'STRONG', 'I', 'EM', 'U', 'BR', 'P', 'UL', 'OL', 'LI', 'SPAN', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'];

    // 4. Recursively traverse and clean the DOM
    function cleanNode(node) {
        // Iterate backwards through children to allow removal without index issues
        for (let i = node.childNodes.length - 1; i >= 0; i--) {
            const child = node.childNodes[i];

            if (child.nodeType === Node.ELEMENT_NODE) {
                if (allowedTags.includes(child.tagName)) {
                    // Allowed tag: remove all attributes to prevent event handlers (e.g., onerror)
                    while (child.attributes.length > 0) {
                        child.removeAttribute(child.attributes[0].name);
                    }
                    // Recursively clean children
                    cleanNode(child);
                } else {
                    // Disallowed tag: remove the tag but keep its text content (or replace with space if appropriate)
                    const textNode = document.createTextNode(child.textContent);
                    node.replaceChild(textNode, child);
                }
            } else if (child.nodeType !== Node.TEXT_NODE) {
                // Remove non-element, non-text nodes (like comments)
                node.removeChild(child);
            }
        }
    }

    cleanNode(tempDiv);

    return tempDiv.innerHTML;
}

/**
 * Strips all HTML tags from a string, returning only the text content.
 * @param {string} html - The HTML string to strip.
 * @returns {string} - The plain text content.
 */
export function stripHTML(html) {
    if (typeof html !== 'string') return String(html || '');
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;
    return tempDiv.textContent || tempDiv.innerText || "";
}
