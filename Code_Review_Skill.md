# Code Review for GHL Opportunity Intake Portal

## Summary
The codebase is well-structured and demonstrates professional practices such as explicit input sanitization, robust audit logging, and careful error handling during multi-step integrations (GHL API, PDF generation, and Firestore). The logic for handling race conditions during contact creation is particularly strong.

## 🔍 Findings & Issues

| File | Line | Severity | Issue | Suggestion |
| :--- | :--- | :--- | :--- | :--- |
| `functions/index.js` | 45 | [MAJOR] | Broad CORS Policy | `cors({ origin: true })` allows any origin. Consider restricting this to your specific Firebase Hosting domain in production. |
| `public/ghl-api.js` | 73 | [MAJOR] | `innerHTML` Usage | Although `escapeHtml` is used, using `innerHTML` for dynamic content is a potential risk. Consider constructing elements with `textContent` for better security. |
| `functions/index.js` | 64 | [NIT] | Basic Sanitization | `replace(/[<>]/g, '')` is a simple filter. For strings meant for HTML, standard escaping is safer. |
| `functions/index.js` | 158 | [NIT] | Error Handling Persistence | `fs.writeFileSync` is used after a template failure. Consider returning an error state to the caller instead of continuing with a broken PDF. |

## ✅ Good Points
*   **Audit Logging**: The `logAudit` helper provides comprehensive visibility into system actions.
*   **Race Condition Mitigation**: The search-then-create pattern with a retry on failure for contact creation is an excellent way to handle GHL API behavior.
*   **Sanitization Layer**: Explicit sanitization functions for strings, emails, and numbers are implemented before any processing.
*   **Modular Automation**: PDF generation and email notifications are wrapped in independent try/catch blocks, ensuring the core process succeeds even if secondary tasks fail.

## 💡 Recommendations
*   **CORS Restriction**: Tighten the `cors` configuration to only allow the portal's production URL.
*   **DOM Manipulation**: Refactor `displayLookupResults` in `public/ghl-api.js` to use `document.createElement` and `textContent` consistently instead of template strings injected via `innerHTML`.
*   **Secret Management**: Ensure that `GHL_API_KEY` is rotated periodically as per security best practices.
