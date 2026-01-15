---
name: api-setup-troubleshooting
description: Expert in setting up, configuring, and debugging API integrations. Specializes in authentication flows, request/response debugging, and resolving connectivity issues.
---

# API Setup and Troubleshooting Skill

This skill is dedicated to the robust integration of external APIs (primarily GoHighLevel/LeadConnector) and ensuring reliable communication between services.

## Core Principles
1. **Connectivity Verification**: Always verify base connectivity and authentication before building complex logic.
2. **Comprehensive Logging**: Implement detailed logging for request payloads, headers, and response bodies to facilitate rapid debugging.
3. **Error Resilience**: Design integrations to handle common API failures (timeouts, rate limits, 5xx errors) gracefully.
4. **Security Best Practices**: Strictly manage API keys and OAuth tokens using secure storage and environment variables.

## Troubleshooting Workflow
1.  **Isolate the Issue**: Determine if the failure is on the client, the proxy, or the external API.
2.  **Verify Authentication**: Check if the API key or Bearer token is valid and has not expired.
3.  **Inspect Payloads**: Validate that the request body matches the API's expected schema (referencing documentation).
4.  **Analyze Responses**: Look beyond the status code; read the response body for specific error messages or hints.
5.  **Test in Isolation**: Use `curl` or Postman to replicate the request outside of the application logic.

## Implementation Checklist
*   [ ] **Endpoint Configuration**: Centralize API base URLs and versioning.
*   [ ] **Header Management**: Ensure all required headers (Content-Type, Authorization, Version) are correctly set.
*   [ ] **Rate Limiting**: Implement basic throttling or retry logic for rate-limited endpoints.
*   [ ] **Secret Validation**: Check that necessary environment variables are loaded before initiating calls.
*   [ ] **Mocking/Testing**: (Optional) Set up mock responses for local development when the live API is unavailable.

---

## GoHighLevel/LeadConnector API Reference

### Base Configuration
- **Base URL**: `https://services.leadconnectorhq.com`
- **API Version Header**: `Version: 2021-07-28` (required on all requests)
- **Content-Type**: `application/json`
- **Authorization**: Bearer Token (OAuth Access Token or Private Integration Token)
- **Token Type**: Sub-Account Token

### Required Scopes
| Endpoint | Scope Required |
|----------|----------------|
| Contacts (Create/Update/Upsert) | `contacts.write` |
| Opportunities | `opportunities.write` |

### Available Endpoints

#### 1. Create Contact
- **Method**: `POST /contacts/`
- **Required Fields**: `locationId`
- **Response**: `201 Created`

#### 2. Update Contact
- **Method**: `PUT /contacts/:contactId`
- **Required Fields**: `contactId` (path parameter)
- **Response**: `200 OK`

#### 3. Upsert Contact
- **Method**: `POST /contacts/upsert`
- **Required Fields**: `locationId`
- **Response**: `200 OK` (returns `new: true/false` to indicate create vs update)

#### 4. Create Opportunity
- **Method**: `POST /opportunities/`
- **Required Fields**: `pipelineId`, `locationId`, `name`, `status`, `contactId`
- **Status Values**: `open`, `won`, `lost`, `abandoned`, `all`
- **Response**: `201 Created`

---

## API Optimization Best Practices

### Prefer Upsert Over Create/Update
Use the **Upsert endpoint** (`POST /contacts/upsert`) instead of separate create/update logic:
- Reduces code complexity by eliminating "check if exists" queries
- Automatically handles duplicate detection based on Location settings
- Returns `new: true/false` flag to indicate whether contact was created or updated
- Use `createNewIfDuplicateAllowed: false` (default) for standard upsert behavior

### Duplicate Contact Handling
The Upsert API respects the Location's "Allow Duplicate Contact" configuration:
- If configured to check both Email and Phone, the API identifies existing contacts based on the priority sequence
- When two separate contacts exist (one matching email, another matching phone), the API updates the first match in the configured sequence
- Set `createNewIfDuplicateAllowed: true` to force new contact creation when duplicates are allowed

### Tags Management
**Warning**: The `tags` field in Update/Upsert endpoints **overwrites all existing tags**.
- For incremental tag changes, use the dedicated **Add Tag** or **Remove Tag** API endpoints
- Only include the full `tags` array when intentionally replacing all tags

### Custom Fields Best Practices
Custom fields support multiple value types. Use the appropriate format:
```json
// Text value
{ "id": "fieldId", "key": "field_key", "field_value": "string value" }

// Numeric value
{ "id": "fieldId", "key": "field_key", "field_value": 100 }

// Multi-select (array)
{ "id": "fieldId", "key": "field_key", "field_value": ["option1", "option2"] }

// File attachment (object)
{ "id": "fieldId", "key": "field_key", "field_value": { "uuid": { "meta": {...}, "url": "...", "documentId": "..." } } }
```
- Use either `id` OR `key` to identify the custom field (not both required)

### Date Format Handling
Supported `dateOfBirth` formats:
- `YYYY-MM-DD` (preferred)
- `YYYY/MM/DD`, `MM/DD/YYYY`
- `YYYY.MM.DD`, `MM.DD.YYYY`
- `YYYY_MM_DD`, `MM_DD_YYYY`

### Error Response Codes
| Code | Meaning | Action |
|------|---------|--------|
| 200/201 | Success | Process response |
| 400 | Bad Request | Validate payload schema |
| 401 | Unauthorized | Check/refresh Bearer token |
| 422 | Unprocessable Entity | Review field values and requirements |

### Payload Optimization
1. **Send only required/changed fields**: Omit nullable fields unless explicitly setting them
2. **Validate locationId**: Required for create/upsert operations; obtain from Location API or configuration
3. **Use contactId efficiently**: For updates, ensure contactId is validated before making the request
4. **Batch considerations**: GHL does not support batch endpoints; implement client-side batching with rate limiting

### Request Header Template
```
Content-Type: application/json
Authorization: Bearer {access_token}
Version: 2021-07-28
```

---

## Resources
Detailed API documentation is available in the `resources/` directory:
- `create-contact-api.md` - Full Create Contact schema and examples
- `update-contact-api.md` - Full Update Contact schema and examples
- `upsert-api.md` - Full Upsert Contact schema and examples
- `opportunity-api.md` - Opportunity creation schema and examples
