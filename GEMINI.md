# Gemini Project Context: GHL Opportunity Intake Portal

## Project Overview
This project is a Sales Opportunity Intake Portal designed to streamline the process of capturing lead information and creating corresponding Opportunities in **GoHighLevel (GHL)**. It consists of a web-based form that calculates product costs and syncs data directly to a GHL sub-account.

## Technology Stack
*   **Frontend:** Vanilla JavaScript, HTML5, CSS3.
*   **Backend:** Node.js, Express.js.
*   **Cloud Platform:** Firebase (Cloud Functions & Hosting).
*   **Integration:** GoHighLevel (GHL) API v2 (LeadConnector).

## Architecture
The application follows a client-server architecture where the frontend captures user input and sends it to a backend proxy (or Cloud Function) which handles the secure communication with the GHL API.

1.  **Frontend (`public/`)**: Handles UI, product row management, cost calculations, and form validation.
2.  **Backend Proxy**:
    *   **Local (`server.js`)**: A local Express server for development that proxies requests to GHL.
    *   **Production (`functions/index.js`)**: A Firebase Cloud Function (`api`) that performs the same role in production, utilizing Firebase Secrets for API key management.
3.  **External Service**: GoHighLevel API (LeadConnector) for Contact and Opportunity management.

## Key Files & Directories

*   **`server.js`**: Local development server. Acts as a proxy to avoid CORS issues and secure API keys locally. Matches the logic in `functions/index.js`.
*   **`public/ghl-api.js`**: Core frontend logic. Handles form submission, dynamic product rows, cost calculations, and API calls to the backend.
*   **`public/index.html`** / **`public/new-opportunity.html`**: The main entry points for the intake form.
*   **`functions/index.js`**: The production backend logic deployed as a Firebase Cloud Function.
*   **`ghl-mapping.md`**: Documentation mapping portal fields to GHL API fields and Custom Fields.
*   **`firebase.json`**: Firebase configuration for Hosting and Functions.

## Setup & Development

### Prerequisites
*   Node.js (v20 recommended)
*   Firebase CLI

### Installation
1.  **Root Dependencies:**
    ```bash
    npm install
    ```
2.  **Functions Dependencies:**
    ```bash
    cd functions
    npm install
    ```

### Running Locally
To run the full stack locally, you need to start the backend proxy and serve the static files.

1.  **Start the Local API Proxy:**
    ```bash
    node server.js
    ```
    *Runs on `http://localhost:3000`.*

2.  **Serve Frontend:**
    You can use any static file server or the Firebase Emulator.
    ```bash
    # Using Firebase Emulator
    firebase emulators:start
    ```

### Deployment
To deploy to Firebase:
```bash
# Deploy all
firebase deploy

# Deploy only functions
firebase deploy --only functions

# Deploy only hosting
firebase deploy --only hosting
```

## Development Conventions

*   **Logic Sync**: The backend logic exists in two places: `server.js` (local) and `functions/index.js` (prod). **Always ensure changes to the backend logic are applied to BOTH files.**
*   **API Versioning**: The project uses GHL API version `2021-07-28`.
*   **Configuration**:
    *   Frontend config (Location ID, Pipeline ID) is found in `public/ghl-api.js` under `CONFIG`.
    *   API Keys are managed via `.env` locally and Firebase Secrets in production.

## Integration Logic (Summary)
When a user submits the form:
1.  **Contact Check**: The backend first checks if a contact with the provided email exists in GHL.
    *   If no, it creates a new Contact.
    *   If yes, it uses the existing Contact ID (and updates it if configured).
2.  **Opportunity Creation**: It then creates an Opportunity linked to that Contact, including custom fields for effective dates, product JSON, and calculated totals.
