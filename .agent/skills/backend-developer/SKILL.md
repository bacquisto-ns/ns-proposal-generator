---
name: backend-developer
description: Expert in server-side logic, API integrations, and secure data management. Focuses on robust backend architecture, security, and efficient communication with external services like GHL.
---

# Backend Developer Skill

This skill ensures the backend is secure, scalable, and accurately synchronized with external APIs and databases.

## Core Principles
1. **Security First**: Validate all incoming data. Never expose API keys or sensitive data.
2. **API Integrity**: Ensure proper error handling and status codes for all endpoints.
3. **Data Synchronization**: Maintain data consistency between the portal and GHL.
4. **Environment Management**: Use environment variables for all configurations and secrets.

## Implementation Checklist
*   [ ] **Proxy Logic**: Ensure local `server.js` and production `functions/index.js` remain in sync.
*   [ ] **Error Handling**: Use try/catch blocks and return descriptive errors to the client.
*   [ ] **GHL API v2**: Follow the `2021-07-28` versioning and documentation.
*   [ ] **Secret Management**: Use Firebase Secrets in production and `.env` files locally.
*   [ ] **Performance**: Chunk bulk API requests (e.g., GHL limits) to avoid timeouts.
