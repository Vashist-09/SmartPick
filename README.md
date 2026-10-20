# SmartPick
Parcel locator hardware module - Embedded systems Project

## Applications

Requires Node.js 20+. Three independent applications coexist in this repository:

- **Student app at the repository root:** dependency-free HTML/CSS/JavaScript with local demo accounts and parcel data.
- **Operator app in `frontend/`:** React/Vite parcel desk connected to the backend for registration, storage assignment, student lookup and retrieval commands.
- **API in `backend/`:** Express/TypeScript connected to the existing Neon PostgreSQL database. It never creates, resets, migrates or seeds the schema.

The student app is not connected to the API yet. Neither frontend replaces the other. Run commands in the directory for the application you intend to use; no workspace or shared dependency installation is required.

## Root student frontend

A dependency-free, responsive mobile web app built with HTML, CSS and JavaScript. Requires Node.js 20 or newer; no dependency installation or build step is needed.

```sh
npm run dev
```

Open http://localhost:5173. To use another port: `PORT=5174 npm run dev`.

```sh
npm test
node --check src/app.js
node --check server.mjs
```

Try `SP1024` (slot A-04), `SP2048` (B-12), or `SP4096` (C-02). Any other valid ID, such as `SP0000`, returns `NOT_FOUND`. Use the Home prototype control to simulate a disconnected ESP32, then retry from Home or Scan. The scanner is a visual placeholder: no camera or BLE permissions are requested. Theme and the last 20 lookups persist in this browser using localStorage when available.

Manual checks: navigate all three tabs; test a known ID, unknown ID and blank input; reopen results from Activity; disconnect and reconnect; switch themes and reload; inspect at mobile and desktop widths.

Files: `index.html` is the app entry point; `src/app.js` contains reusable views and interactions; `src/data.js` contains mock parcel lookup; `src/styles.css` contains responsive themes; `server.mjs` serves the local preview; `tests/data.test.js` checks lookup behavior.

## Student account demo

Routes: `#home`, `#scan`, `#activity`, `#result`, `#login`, `#register`, `#forgot`, `#profile`, and `#settings`. Open the header avatar for profile, settings and sign-out. On desktop, navigation moves to a sidebar; mobile retains bottom navigation.

There is **no student authentication backend**. Registration and profile edits save only name, VIT registration number, email and optional phone in localStorage. First-time demo login accepts a valid email/student ID and any disposable password of at least 8 characters; it does not verify credentials. Once a profile is saved, login must match that profile’s email or registration number. Registration can explicitly replace the local demo profile. Passwords are never persisted or transmitted. The demo session uses sessionStorage. Recovery explains the limitation and sends no email. Use sample information, not real account credentials.

Signing out clears the current demo session and pending lookup, while leaving the local demo profile and shared browser activity available for subsequent demos. These records are not private accounts and are not separated per student. Theme changes persist locally across all routes. Camera and BLE remain disabled.

Build a static copy (no dependencies or bundling required):

```sh
npm run build
```

The output is `dist/`, ready for any static web server. `npm run dev` continues to serve the source. Tests now cover account validation and password-free profile normalization as well as parcel lookup. Manual account checks: register, toggle password visibility, edit and reload a profile, use menu arrow keys/Escape, switch themes in Settings, sign out, log back in with the saved ID, and try recovery. Storage-disabled browsers can use the demo in memory but cannot retain changes after reload.

## Backend API (`backend/`)

Copy `backend/.env.example` to `backend/.env` and configure `DATABASE_URL`, distinct `OPERATOR_API_KEY` and `ESP32_API_KEY`, and `CORS_ORIGIN` for the operator app. The database must already contain the expected schema; see [docs/database.md](docs/database.md).

```sh
cd backend
npm ci
npm run build
npm start
```

Use `npm run dev` in `backend/` for development. The default API port is `5050`. There is no backend test script. See [backend/ESP32_API.md](backend/ESP32_API.md) for device polling and events; no firmware is supplied here.

## Operator frontend (`frontend/`)

Copy `frontend/.env.example` to `frontend/.env`. Set `VITE_API_URL` to the backend origin (default `http://localhost:5050`) and `VITE_OPERATOR_API_KEY` to the operator key. This existing prototype sends the shared operator key from the browser; use only in a trusted operator/demo environment. Do not copy this key or `DATABASE_URL` into the student app. Student authentication and authorization integration are outside this merge.

```sh
cd frontend
npm ci
npm run dev -- --port 5174 --strictPort
```

When using operator port `5174`, set backend `CORS_ORIGIN=http://localhost:5174`. This allows the root student app to keep port `5173`. If the student app is stopped, the operator app may instead use its normal `npm run dev` default port `5173`, with matching CORS configuration. Each server runs in a separate terminal.

Build and preview the operator app independently:

```sh
cd frontend
npm run build
npm run preview -- --port 4174 --strictPort
```

For API access from the preview, set backend `CORS_ORIGIN=http://localhost:4174`. There is no operator frontend test script.

Root, backend and operator build outputs are respectively `dist/`, `backend/dist/` and `frontend/dist/`; all are ignored by Git. Environment files and dependency directories are also ignored. Commit neither real credentials nor generated output.
