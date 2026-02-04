/**
 * Verification script for XSS sanitization functions.
 * Run this in a browser console or include it in a test page.
 */

import { sanitizeHTML, escapeHTML, stripHTML } from './utils.js';

console.log("%c Starting XSS Sanitization Tests ", "background: #1976d2; color: white; font-weight: bold;");

const testCases = [
    {
        name: "escapeHTML - Malicious Input",
        input: '<img src=x onerror=alert(1)>',
        fn: escapeHTML,
        expected: '&lt;img src=x onerror=alert(1)&gt;'
    },
    {
        name: "sanitizeHTML - Disallowed Tags (script)",
        input: '<b>Safe</b><script>alert("xss")</script>',
        fn: sanitizeHTML,
        expected: '<b>Safe</b>'
    },
    {
        name: "sanitizeHTML - Attributes (onerror)",
        input: '<p style="color:red" onclick="alert(1)">Text</p>',
        fn: sanitizeHTML,
        expected: '<p>Text</p>'
    },
    {
        name: "sanitizeHTML - Nested Malicious Tags",
        input: '<div>Outer<iframe src="javascript:alert(1)"></iframe></div>',
        fn: sanitizeHTML,
        expected: '<div>Outer</div>'
    },
    {
        name: "sanitizeHTML - Allowed Formatting Preserved",
        input: '<strong>Important</strong> <i>italics</i> <br> <p>Paragraph</p>',
        fn: sanitizeHTML,
        expected: '<strong>Important</strong> <i>italics</i> <br> <p>Paragraph</p>'
    },
    {
        name: "stripHTML - Simple",
        input: '<div>Text <b>More</b></div>',
        fn: stripHTML,
        expected: 'Text More'
    }
];

let passed = 0;
testCases.forEach(tc => {
    const result = tc.fn(tc.input);
    // Note: DOM-based sanitization might normalize whitespace/quotes, so comparison might need care
    // But for these cases, it should be straightforward.
    if (result === tc.expected) {
        console.log(`%c[PASS] ${tc.name}`, "color: green;");
        passed++;
    } else {
        console.error(`%c[FAIL] ${tc.name}`, "color: red;");
        console.log(`  Input: ${tc.input}`);
        console.log(`  Expected: ${tc.expected}`);
        console.log(`  Actual:   ${result}`);
    }
});

console.log(`%c Tests complete: ${passed}/${testCases.length} passed `, "background: #1976d2; color: white; font-weight: bold;");
