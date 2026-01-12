# Audit Log Gap Analysis & Recommendations

## Current State Analysis
*   **Schema**: Captures `timestamp`, `action`, `resourceType`, `resourceId`, `details` (snapshot), and `metadata` (IP, User Agent).
*   **UI**: Displays a chronological table. "Details" column dumps raw JSON, making the table hard to scan.
*   **Coverage**: Currently appears to primarily log `CREATE` events for Opportunities and Contacts. `UPDATE` events or Failures are not explicitly handled in the visible snippets.

## Recommendations for a "True Audit Log"

### 1. Identify the "Actor" (Who)
*   **Gap**: Currently, we only know the IP address. We don't know *who* triggered the action (e.g., "Broker John Doe" or "System Admin").
*   **Recommendation**:
    *   Update `logAudit` to look for user context in `req.body` or headers (e.g., `req.body.userEmail` or `req.headers['x-user-id']`).
    *   Add an `actor` field to the schema: `{ id: "...", name: "...", role: "..." }`.

### 2. Status & Error Tracking (Outcome)
*   **Gap**: The current log assumes success. If an operation fails, it might just throw an error and not leave an audit trail, or leave a partial one.
*   **Recommendation**:
    *   Add a `status` field: `'SUCCESS' | 'FAILURE' | 'WARNING'`.
    *   Log failures in `catch` blocks with `status: 'FAILURE'` and `errorDetails`.

### 3. "Before & After" for Updates (Context)
*   **Gap**: If an Opportunity is updated, simply logging the new state doesn't show *what changed*.
*   **Recommendation**:
    *   For `UPDATE` actions, the `details` should explicitly structure changes:
        ```json
        {
          "changes": [
            { "field": "status", "old": "new", "new": "won" },
            { "field": "amount", "old": 1000, "new": 1200 }
          ]
        }
        ```

### 4. Correlation ID (Traceability)
*   **Gap**: A single form submission creates a Contact, an Opportunity, and uploads a PDF. These appear as separate, disconnected logs.
*   **Recommendation**:
    *   Generate a unique `correlationId` at the entry point (API).
    *   Pass this ID to all subsequent `logAudit` calls. This allows grouping all events related to a single user request.

### 5. Frontend/UX Improvements
*   **Gap**: The "Details" column displays raw, unformatted JSON, which breaks the table layout and is hard to read.
*   **Recommendation**:
    *   **Hide Complexity**: Replace the raw JSON with a **"View Details"** button that opens a modal.
    *   **Filters**: Add input fields to filter by `Resource ID`, `Action Type`, or `Date Range`.
    *   **Visual Indicators**: Color-code the `status` (Green for Success, Red for Failure).

### 6. Export Capability
*   **Gap**: No way to extract logs for external compliance review.
*   **Recommendation**: Add a "Export to CSV" button in the Admin UI.
