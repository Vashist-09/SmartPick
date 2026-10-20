# SmartPick
Parcel locator hardware module - Embedded systems Project

## Frontend prototype

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

There is **no authentication backend**. Registration and profile edits save only name, VIT registration number, email and optional phone in localStorage. Login accepts a valid email/student ID and any disposable password of at least 8 characters; it does not verify credentials. Passwords are never persisted or transmitted. The demo session uses sessionStorage. Recovery explains the limitation and sends no email. Use sample information, not real account credentials.

Signing out clears the current demo session and pending lookup, while leaving the local demo profile and shared browser activity available for subsequent demos. These records are not private accounts and are not separated per student. Theme changes persist locally across all routes. Camera and BLE remain disabled.

Build a static copy (no dependencies or bundling required):

```sh
npm run build
```

The output is `dist/`, ready for any static web server. `npm run dev` continues to serve the source. Tests now cover account validation and password-free profile normalization as well as parcel lookup. Manual account checks: register, toggle password visibility, edit and reload a profile, use menu arrow keys/Escape, switch themes in Settings, sign out, log back in with the saved ID, and try recovery. Storage-disabled browsers can use the demo in memory but cannot retain changes after reload.
