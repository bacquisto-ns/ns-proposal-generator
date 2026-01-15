# Code Review for [File/Feature Name]

## Summary
[A brief 1-2 sentence summary.]

## 🔍 Findings & Issues

| File | Line | Severity | Issue | Suggestion |
| :--- | :--- | :--- | :--- | :--- |
| `src/main.js` | 42 | [CRITICAL] | Potential XSS | Use `textContent` instead of `innerHTML` |

## ✅ Good Points
*   Clean separation of concerns.

## 💡 Recommendations
*   Consider refactoring the large function `processData`.
