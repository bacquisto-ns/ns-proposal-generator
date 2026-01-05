# GHL Opportunity API Mapping Documentation

This document outlines the mapping between the Opportunity Intake Portal fields and the Go High Level (GHL) API payload.

## 1. Contact Creation/Search
Before creating an opportunity, the contact should be identified or created.

| Portal Field | GHL Field | Description |
|--------------|-----------|-------------|
| Broker Name | `firstName` / `lastName` | Lookup field that fetches contacts from GHL |
| Broker Email| `email` | Auto-populated from lookup selection |
| Broker Agency| `companyName` | Auto-populated from lookup selection |

> [!NOTE]
> The **Broker Name** field now features a dynamic autocomplete lookup that queries existing contacts in the GHL sub-account. Selecting a contact automatically populates the email and agency fields. If no contact is found, users can select the **"+ [Name] (Create New Contact)"** option to explicitly create a new broker record during submission.

## 2. Opportunity Fields
The following fields are mapped to the Opportunity object.

| Portal Field | GHL Payload Field | Notes |
|--------------|-------------------|-------|
| Generated Name | `name` | Format: `[Broker] - [Business] - [Effective Date]` |
| Pipeline ID | `pipelineId` | Configurable in `ghl-api.js` |
| Stage ID | `pipelineStageId` | Configurable in `ghl-api.js` |
| Status | `status` | Hardcoded to "open" (Open, Won, Lost, Abandoned dropdown removed) |
| Opportunity Value | `monetaryValue` | Map to Yearly Total Fee |

## 3. Custom Field Mappings
These fields must be created as Custom Fields in the GHL sub-account.

| Portal Field | GHL Custom Field Key | Data Type |
|--------------|----------------------|-----------|
| Effective Date | `opportunity.effective_date` | Date |
| Proposal Date | `opportunity.proposal_date` | Date |
| Total Employees | `opportunity.total_employees` | Number |
| Opportunity Source | `opportunity.source` | Single Select |
| Current Administrator | `opportunity.current_administrator` | Text |
| Ben Admin System | `opportunity.ben_admin_system` | Text |
| Products Desired | `opportunity.rfp_products_desired` | Large Text / JSON |
| Monthly Total Fee | `opportunity.monthly_total` | Currency / Number |
| Yearly Total Fee | `opportunity.yearly_total` | Currency / Number |
| Postal Code | `opportunity.postal_code` | Text |
| Requires Approval | `opportunity.requires_approval` | Single Select (Yes/No) |
| Approver Name | `opportunity.approver_name` | Text |

## 4. Chatbot Integration Logic
For the GHL Chatbot (Chat Widget), the following flow is recommended:

1. **Trigger**: User starts chat.
2. **Data Collection**: Ask for Business Name, Email, and Products of interest.
3. **Webhook**: Send data to a GHL Workflow.
4. **Workflow Actions**:
   - Create/Update Contact.
   - Create Opportunity in the Sales Pipeline.
   - Assign to User.

