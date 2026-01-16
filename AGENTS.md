# Repository Guidelines

## Project Structure & Module Organization
- `server.js` is the local Express API that serves `/public` and orchestrates proposal generation and GHL calls.
- `public/` holds browser UI assets (`index.html`, `admin.html`, `style.css`, `admin.js`, `ghl-api.js`).
- `shared/` contains reusable server utilities and data (`utils.js`, `products.json`); `functions/shared/` mirrors this for Cloud Functions.
- `functions/` is the Firebase Cloud Functions app (`functions/index.js`) with its own `package.json`.
- PDF templates and reference docs live at repo root and `functions/` (treat as read-only assets).
- Firebase config is in `firebase.json`, `firestore.rules`, `firestore.indexes.json`.

## Build, Test, and Development Commands
- `node server.js` from repo root runs the local API and static site (requires `GHL_API_KEY`).
- `npm test` at repo root currently exits with "no test specified".
- `cd functions` then `npm run serve` starts Firebase emulators for functions.
- `cd functions` then `npm run deploy` deploys functions.
- `cd functions` then `npm run logs` tails Cloud Functions logs.

## Coding Style & Naming Conventions
- JavaScript uses CommonJS (`require`, `module.exports`) and 4-space indentation.
- Use `camelCase` for variables/functions and `PascalCase` for classes.
- Keep file naming consistent with its folder (root scripts use `snake_case` such as `get_custom_fields.js`).

## Testing Guidelines
- No automated tests are wired up yet; add tests alongside new logic and document how to run them.
- For manual checks, validate key flows (contact upsert, opportunity creation, PDF output).

## Commit & Pull Request Guidelines
- Commit subjects are short, imperative, and descriptive (for example, "Fix Opportunity creation linkage").
- PRs should explain behavior changes, link related issues, and call out config or env var updates.
- Include screenshots for UI changes under `public/`.

## Security & Configuration Tips
- Store secrets in `.env` and never commit API keys.
- Verify `FIREBASE_PROJECT_ID` and `GHL_API_KEY` when running locally.
