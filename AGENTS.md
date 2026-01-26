# Repository Guidelines

## Project Structure & Module Organization
- `server.js` runs the local Express API, serves `/public`, and orchestrates proposal generation and GHL calls.
- `public/` contains browser UI assets (`index.html`, `admin.html`, `style.css`, `admin.js`, `ghl-api.js`).
- `shared/` holds reusable server utilities and data (`utils.js`, `products.json`); `functions/shared/` mirrors this for Cloud Functions.
- `functions/` is the Firebase Cloud Functions app (`functions/index.js`) with its own `package.json`.
- PDF templates and reference docs live at repo root and inside `functions/` (treat as read-only assets).
- Firebase config lives in `firebase.json`, `firestore.rules`, `firestore.indexes.json`.

## Build, Test, and Development Commands
- `node server.js`: start local API + static site (requires `GHL_API_KEY`).
- `npm test`: currently exits with “no test specified”.
- `cd functions` then `npm run serve`: start Firebase emulators for functions.
- `cd functions` then `npm run deploy`: deploy Cloud Functions.
- `cd functions` then `npm run logs`: tail Cloud Functions logs.

## Coding Style & Naming Conventions
- JavaScript uses CommonJS (`require`, `module.exports`) with 4-space indentation.
- Use `camelCase` for variables/functions and `PascalCase` for classes.
- File naming: keep consistent with folder; root scripts use `snake_case` (example: `get_custom_fields.js`).

## Testing Guidelines
- No automated tests wired up yet. Add tests alongside new logic and document how to run them.
- For manual checks, validate key flows: contact upsert, opportunity creation, and PDF output.

## Commit & Pull Request Guidelines
- Commit subjects should be short, imperative, and descriptive (example: “Fix opportunity creation linkage”).
- PRs should explain behavior changes, link related issues, and call out config/env var updates.
- Include screenshots for UI changes under `public/`.

## Security & Configuration Tips
- Store secrets in `.env`; never commit API keys.
- Verify `FIREBASE_PROJECT_ID` and `GHL_API_KEY` when running locally.
