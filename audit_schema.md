# Firestore Schema: Audit Logs

## Overview
The `audit_logs` collection stores a chronological record of all critical write operations (Create, Update, Delete) performed within the application. This ensures accountability and allows for debugging and security auditing.

## Collection Structure
*   **Collection Name**: `audit_logs`
*   **Database**: `(default)`

## Document Schema

Each document in the `audit_logs` collection represents a single event.

| Field | Type | Description |
| :--- | :--- | :--- |
| `timestamp` | `Timestamp` | Server-side timestamp of when the event occurred. |
| `action` | `String` | The type of operation. Values: `CREATE`, `UPDATE`, `DELETE`. |
| `resourceType` | `String` | The entity being modified. Values: `Opportunity`, `Contact`. |
| `resourceId` | `String` | The unique identifier of the modified entity (e.g., GHL ID). |
| `details` | `Map` | A snapshot of the data that was sent/modified. |
| `metadata` | `Map` | Contextual information about the request. |
| `metadata.ip` | `String` | IP address of the requester (or 'system' if internal). |
| `metadata.userAgent`| `String` | User Agent string of the requester. |
| `metadata.endpoint` | `String` | The API endpoint that triggered the event. |

## Access Pattern
*   **Write**: Only the Admin SDK (Backend/Cloud Functions) has write access. Client-side writes should be disabled via security rules.
*   **Read**: Authorized Admin users (via the Admin Dashboard).

## Retention Policy
*   *Current*: Indefinite retention.
*   *Future Recommendation*: Implement a TTL (Time-To-Live) policy to auto-delete logs older than 90 days if storage costs increase.
