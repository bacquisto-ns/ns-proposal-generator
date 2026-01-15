# Create Opportunity API

Creates a new opportunity in the system.

---

## Endpoint

**POST**  
`https://services.leadconnectorhq.com/opportunities/`

---

## Requirements

### Scopes
- `opportunities.write`

### Authentication Methods
- OAuth Access Token
- Private Integration Token

### Token Types
- Sub-Account Token

---

## Headers

| Header | Type | Required | Description |
|------|------|----------|-------------|
| Version | string | ✅ | API version. Possible values: `2021-07-28` |
| Authorization | string | ✅ | Bearer token |

---

## Request Body

**Content-Type:** `application/json`

### Required Fields

| Field | Type | Required | Description |
|------|------|----------|-------------|
| pipelineId | string | ✅ | Pipeline ID |
| locationId | string | ✅ | Location ID |
| name | string | ✅ | Opportunity name |
| status | string | ✅ | One of: `open`, `won`, `lost`, `abandoned`, `all` |
| contactId | string | ✅ | Contact ID |

### Optional Fields

| Field | Type | Description |
|------|------|-------------|
| pipelineStageId | string | Pipeline stage ID |
| monetaryValue | number | Opportunity value |
| assignedTo | string | User ID assigned to the opportunity |
| customFields | array | Custom field values |

---

## Custom Fields Structure

`customFields` is an array of objects. Each object supports the following schemas:

### Custom Field Object

| Field | Type | Description |
|------|------|-------------|
| id | string | Custom field ID (pass either `id` or `key`) |
| key | string | Custom field key (pass either `id` or `key`) |
| field_value | string \| array \| object | Value of the custom field |

### Example Custom Fields

```json
[
  {
    "id": "6dvNaf7VhkQ9snc5vnjJ",
    "key": "my_custom_field",
    "field_value": "9039160788"
  },
  {
    "id": "6dvNaf7VhkQ9snc5vnjJ",
    "key": "my_custom_field",
    "field_value": ["test", "test2"]
  },
  {
    "id": "6dvNaf7VhkQ9snc5vnjJ",
    "key": "my_custom_field",
    "field_value": {}
  }
]
