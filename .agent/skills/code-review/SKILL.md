---
name: code-review
description: Conducts a comprehensive code review for a given set of files. Checks for logical errors, security vulnerabilities, performance bottlenecks, and adherence to coding standards. Use this skill when asked to review a PR, analyze a specific file, or QC code before deployment.
---

# Code Review Skill

This skill guides the agent through a professional code review process, prioritizing security and correctness before style.

## Review Flow (Decision Tree)

1.  **Analyze Request**: Identify which files are being changed and the goal of the changes.
2.  **Security Check (CRITICAL)**:
    *   **IF** security vulnerabilities (SQLi, XSS, exposed secrets) are found -> **STOP** implementation/review immediately. Flag as `[CRITICAL]` and explain why.
    *   **ELSE** -> Proceed to Logic Check.
3.  **Logic & Correctness**:
    *   **IF** logic is unclear, complex, or buggy -> Ask clarifying questions or propose a logic fix.
    *   **ELSE** -> Proceed to Performance & Style.
4.  **Style & Performance**:
    *   Bundle minor style nits at the end.
    *   Highlight performance issues only if they might cause significant lag or cost.

## Detailed Review Checklist

### 1. Security (Highest Priority)
*   [ ] **Input Validation**: Are inputs validated and sanitized?
*   [ ] **Secrets**: No hardcoded secrets/API keys?
*   [ ] **Auth**: Are authorization/authentication checks present?
*   [ ] **Data Exposure**: Is sensitive data properly masked or handled?

### 2. Logic & Functionality
*   [ ] **Goal**: Does the code meet the user's stated goal?
*   [ ] **Edge Cases**: Are null values, empty lists, and boundary conditions handled?
*   [ ] **Error Handling**: Are errors caught and logged gracefully?
*   [ ] **Complexity**: Is the code overly complex? Can it be simplified?

### 3. Style & Maintenance
*   [ ] **Naming**: Are variable/function names descriptive?
*   [ ] **Cleanliness**: No dead code (commented-out blocks) or console logs?
*   [ ] **Consistency**: Does it follow the existing codebase patterns?
*   [ ] **Docs**: Are complex functions documented?

## Output Format

Please provide your review in the following format:

### Summary
[A brief 1-2 sentence summary of the changes and overall quality.]

### 🔍 Findings & Issues

| File | Line | Severity | Issue | Suggestion |
| :--- | :--- | :--- | :--- | :--- |
| `path/to/file` | 10 | [CRITICAL] | Hardcoded API Key | Use environment variables |
| `path/to/file` | 45 | [MAJOR] | Logic error in loop | Fix loop condition |
| `path/to/file` | 92 | [NIT] | Indentation off | Fix indent to 2 spaces |

### ✅ Good Points
*   [List things done well]

### 💡 Recommendations
*   [Next steps or high-level improvements]
