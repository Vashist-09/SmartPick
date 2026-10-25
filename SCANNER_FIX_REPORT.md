# SmartPick: scanner fix and audit report

Date: 2026-10-25. Base commit: `7daafb1` ("reverted previous errors"). **Nothing was committed, pushed or deployed.** All changes are uncommitted working-tree edits, also supplied as `smartpick-scanner-fix.patch`.

## A. Executive summary

The ID scanner opened the camera but almost never recognised a real, handheld card. Two defects caused this:

1. **The decoder was too fragile for real camera frames.** `@zxing/browser` ran with default settings, which means no "try harder" mode and horizontal scan lines only. It decoded a perfectly level, sharp barcode, but failed on a card tilted 12°, a slightly out-of-focus frame, and a dim or noisy frame. Those three conditions describe a card held up to a laptop or phone camera.
2. **The error handling was wrong.** The code ignored "no barcode in this frame" by checking `error.name !== 'NotFoundException'`. The production build minifies class names, so `name` became `"e"`. As a result, every frame without a barcode showed the red error *"No MultiFormat Readers were able to detect the code.. Enter the registration number manually instead."* within a second of opening the scanner. ZXing 0.23 also printed a console warning with a stack trace for each reader on each frame (168 warnings in 14 seconds).

The scanner has been rebuilt on zxing-cpp (WebAssembly), running in a Web Worker. It uses multi-pass decoding (full frame, guide region, rotations, zoom), keeps a correct camera lifecycle, and has explicit states for every outcome. Photo upload and manual entry go through the same validation and lookup as a camera scan. The backend lookup now tells "unknown student" (404) apart from "student with no parcels" and validates input.

Every other control on the page was also exercised and fixed where needed. The fixes cover undefined CSS variables that made the login card and scanner dialog transparent, unguarded double submits, a route alias that exposed parcel-creation under `/api/students`, malformed JSON returning 500, missing timeouts, and session expiry. All tests pass: 12 backend, 30 unit/decoder, 35 browser E2E.

## B. Root-cause analysis

**Evidence.** The deployed bundle `index-CK0QSkJ1.js` is byte-identical in name to a local build of the zip, so the zip is exactly what is live.

| Reproduction (original build, headless Chromium, fake camera playing a synthetic card) | Result |
|---|---|
| Level, sharp card | Detected in about 0.5 s |
| Card tilted 12° | **Never detected** in 14 s. Red error shown throughout. 168 console warnings |
| Out of focus (Gaussian blur 1.6 px) | **Never detected**, same symptoms |
| Low light + sensor noise | **Never detected**, same symptoms |

A decoder-level check with the same ZXing configuration in Node gave the same pattern: it fails angled, blurred and low-light frames and passes clean ones.

**Affected code:** `frontend/src/components/BarcodeScanner.tsx`, specifically the `useEffect` that calls `BrowserMultiFormatReader.decodeFromConstraints`:

- No decode hints, so 1-D readers scan about 15 rows near the vertical centre and have no rotation tolerance.
- `error.name !== 'NotFoundException'` does not survive minification, which caused the false red error every frame.
- `controls` is assigned only inside the per-frame callback. If the component unmounted before the first callback (for example React StrictMode in development, or closing quickly), the camera stream was never stopped and a second decode loop attached to the same `<video>`.
- `onScan` was an inline arrow, so the effect's dependency changed on every parent render and could restart the camera.

**Correction:** see section C. The new decoder reads all 12 synthetic camera conditions that contain a readable barcode, including ±12° and 25° tilt, perspective, distance, blur, low light, glare, low contrast and upside-down. It returns nothing for a blank frame or a heavily damaged barcode.

**What is not yet verified:** your physical card. I did not have a sample, so I don't know its symbology or barcode size. The scanner supports every common ID-card symbology (section E). The *Scanner diagnostics* panel shows the format read from your card. If it still fails, a redacted photo of the barcode area would settle it.

## C. Changelog

**Frontend**
- `src/scanner/decodeCore.ts` (new): enabled formats; multi-pass live decoding (full frame, guide crop, ±10°, ±20°, 2× zoom, zoom ±10°); exhaustive still-image decoding for uploads.
- `src/scanner/imageOps.ts` (new): pure crop/scale/rotate on RGBA, shared by the worker and the Node tests.
- `src/scanner/decode.worker.ts` (new) and `decoderClient.ts` (new): zxing-wasm in a Web Worker, WASM bundled locally (no CDN), request IDs, timeouts, transfer of frame buffers, termination.
- `src/scanner/acceptor.ts` (new): accept-once logic. Formats without a mandatory check digit (Code 39, Codabar, ITF) require two identical reads.
- `src/scanner/identifier.ts` (new): normalises the value (strips control characters and `*…*` Code 39 wrappers, collapses whitespace) and validates it, preserving case and leading zeros. Also redacts values for diagnostics.
- `src/scanner/nativeDetector.ts` (new, update 2): uses the browser's built-in `BarcodeDetector` as an extra pass when present. Chrome on macOS backs it with Apple Vision and Chrome on Android with ML Kit, both of which cope better with soft focus. Feature-detected; zxing-wasm still runs on every frame. Added after a real VIT card on a MacBook webcam failed to decode because the barcode was optically blurred (zxing-cpp found no barcode in that frame with any binarizer or sharpening).
- `src/scanner/camera.ts` (new): secure-context check, `getUserMedia` with fallback, wait until frames actually have size, continuous autofocus where supported, torch detection, error translation (permission, no camera, camera in use, timeout).
- `components/BarcodeScanner.tsx` (rewritten): state machine (starting, scanning, invalid, no-code-in-upload, error), one decode in flight at a time, guide box mapped to frame pixels, camera switching, torch, upload, retry, "Type it instead", Escape to close, focus restore, `aria-live` status, diagnostics panel, full cleanup on close/unmount/retry/success.
- `components/StudentLookup.tsx`: one lookup path for typed, scanned and uploaded values; newer lookups cancel older ones; separate messages for 404 / error / no parcels; shows which method found the student (e.g. "scan · Code 128").
- `components/StorageAssignment.tsx`, `ParcelRegistration.tsx`, `OperatorLogin.tsx`, `CompartmentGrid.tsx`, `App.tsx`: busy states that block double submits, success vs error tones, client validation, loading skeleton, session-expiry return to sign-in, refresh pauses while the tab is hidden, Retry on the error banner.
- `api.ts`: 15 s timeout, `ApiError` with status/kind, network vs timeout messages, 401 broadcast.
- `styles.css`: defined the tokens the CSS used but never declared (`--line`, `--card`, `--shadow`, `--muted`, `--input`, `--text`); consistent button system; focus-visible; card-shaped scan guide; reduced-motion support; responsive fixes. Same palette and fonts as before.
- `package.json`: removed `@zxing/browser`, added `zxing-wasm@3.1.6`; moved `@vitejs/plugin-react` to devDependencies; added test tooling. `npm audit`: 0 vulnerabilities.

**Backend**
- `src/routes/students.ts` (new) and `src/students.ts` (new): `GET /api/students/:registrationNo/parcels` validates input. It returns `{registrationNo, parcels}`, or 404 (unknown), 409 (ambiguous), 400 (malformed). Matching is exact first, then a case-insensitive match only if it is unique.
- `src/routes/parcels.ts`: the lookup moved out. Registration reuses a student whose number differs only in letter case, which avoids split records. Duplicate tracking ID message is clearer. The retrieve response includes `existing` so the UI can say a command was already queued.
- `src/server.ts`: `/api/students` no longer aliases the parcels router (which had exposed `POST /api/students` and `/api/students/:id/store`). Also adds a JSON 404 for unknown `/api/*`, 400/413 for bad bodies, security headers (`nosniff`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy: camera=(self)`), removes `x-powered-by`, and exports the app for tests.
- `src/schemas.ts`: shared registration-number rule; length limits on name and tracking ID.
- `package.json`: `zod` 3 → 4.6.7 and `body-parser` 1.20.9 for security advisories; `npm audit`: 0 vulnerabilities.
- `test/schema.sql`, `test/api.test.ts` (new): test-only schema reconstruction and integration tests.

**Breaking API change:** `GET /api/students/:reg/parcels` used to return a bare array (empty for unknown students). It now returns `{registrationNo, parcels}` or 404. Both frontend callers were updated; the ESP32 does not use this route.

## D. Functional QA matrix

| Feature | Test performed | Result | Evidence |
|---|---|---|---|
| Sign in (wrong / right password), session survives refresh | E2E | PASS | workflows.spec #1 |
| Sign out, protected API returns 401 afterwards | E2E | PASS | workflows.spec #5 |
| Session expires mid-use, returns to sign-in with message | E2E | PASS | scanner.spec "expired session" |
| Register parcel (validation, double-click sends one POST, form reset) | E2E + API | PASS | workflows #2/#3, api #6 |
| Duplicate tracking ID reported | E2E + API | PASS | workflows #3, api #6 |
| Assign storage (find, select, assign, map updates, list refresh) | E2E | PASS | workflows #2 |
| Occupied compartment / double store rejected | API | PASS | api #10 |
| Compartment map (3×2, live refresh, loading skeleton) | E2E + API | PASS | workflows #1, api #5 |
| Find a student (typed): empty, unknown, found | E2E | PASS | workflows #4 |
| Light compartment, deduplicated second press | E2E + API | PASS | workflows #2, api #10 |
| ESP32 poll, result, removal event (idempotent), shown as COLLECTED | E2E + API | PASS | workflows #2, api #10 |
| Scan ID card (12 camera conditions) | E2E, fake camera | PASS | scanner.spec #1–12 |
| Scanner: close button, Escape, backdrop click, reopen ×5, camera released | E2E | PASS | scanner.spec "opening and closing" |
| Scanner: Scan again / Retry camera | E2E | PASS | scanner.spec "retry" |
| Scanner: Upload photo | E2E | PASS | scanner.spec "photo upload" |
| Scanner: Type it instead / Edit as registration number | E2E | PASS | scanner.spec "permission denied", "invalid characters" |
| Built-in detector path (simulated API: result flow, Code 39 confirmation, fallback when it throws) | E2E | PASS | scanner.spec "[simulated native API]" |
| Focus/distance tip after 8 s without a read | E2E | PASS | scanner.spec "after 8 s" |
| Scanner: camera switch dropdown | Not automatable (headless Chromium exposes one fake camera) | BLOCKED | Manual check: device with 2+ cameras |
| Scanner: Flash on/off | Shown only when the track reports `torch` | BLOCKED | Manual check: Android Chrome with rear camera |
| Responsive (375 / 768 / 1440 px), no horizontal scroll, dialog fits | E2E | PASS | workflows #6–8 |
| Console errors on main flows | E2E | PASS | asserted empty in flows |
| `ParcelRetrieval.tsx` | Not rendered anywhere (dead component, kept) | NOT IMPLEMENTED in UI | — |

## E. Scanner test report

Formats enabled: Code 128, Code 39, Code 93, Codabar, ITF, EAN-13, EAN-8, UPC-A, UPC-E, DataBar, DataBar Expanded, QR, PDF417, Data Matrix, Aztec. This matches the set the old reader tried by default. Unsupported-format test: MaxiCode.

| Case | Decoder (Node, real zxing-wasm) | Browser + fake camera + real API |
|---|---|---|
| Code 128 / Code 39 / QR / PDF417 / Aztec card | PASS | Code 128, Code 39, QR: PASS |
| Leading zeros `0012345` (≠ `12345`) | PASS | PASS (API also returns 404 for `12345`) |
| Lower-case code matching an upper-case record | PASS | PASS |
| Tilt ±12°, 25°, perspective, far, low in frame, upside down | PASS | PASS |
| Blur, low light + noise, glare, low contrast | PASS | PASS |
| No barcode / heavily damaged | Correctly returns nothing | Keeps scanning, no false error |
| Unsupported symbology (MaxiCode) | Correctly returns nothing | Upload reports "no supported barcode" |
| Decodes, but no student record | — | "No student … on record" |
| Invalid characters (`24CS104;DROP`) | — | Rejected, not sent to the API, editable |
| Permission denied / no camera | — | Actionable message + fallbacks (simulated `getUserMedia` rejection) |
| Decoder WASM fails to load, then Retry | — | Error state, recovers on Retry |
| API 500 / API never answers | — | Error shown / 15 s timeout message |
| Rapid repeat detections | Acceptor unit test | Exactly one lookup request |

Browser: headless Chromium (Playwright 1.63) on Linux, fake camera at 1280×720. **Not tested:** real camera hardware, iOS Safari, Android Chrome, Firefox, and your physical card.

## F. Automated test results (commands actually run)

```
TEST_DATABASE_URL=postgresql://…/smartpick_test npm --prefix backend test   → 12 tests, 12 pass, 0 fail
npm --prefix frontend run test:unit                                         → 30 tests, 30 pass, 0 fail
TEST_DATABASE_URL=… npx playwright test (frontend)                          → 39 passed, 1 skipped (screenshot capture, opt-in)
npm ci --include=dev … && npm run build (Render's exact build command, clean copy) → success
tsc (backend and frontend) → no errors; npm audit → 0 vulnerabilities in both packages
```

## G. Security and performance

- **Fixed:** route alias exposing parcel creation at `/api/students`; server-side registration validation; 400 instead of 500 for bad JSON; security headers; dependency advisories (body-parser, zod; vitest avoided); no raw ID values in logs (diagnostics redact to the last two characters); WASM served same-origin.
- **Unchanged and fine:** HttpOnly + SameSite=Strict + Secure (production) signed session cookie; timing-safe password comparison; login rate limit; device key on device routes.
- **Remaining risks:** the login rate limiter is in-memory (resets on restart, per instance). There is no Content-Security-Policy; one would need `'wasm-unsafe-eval'` and should be tested on Safari before enabling. Registering a parcel overwrites the stored student name (existing behaviour, left as a business decision).
- **Performance:** main JS bundle 613 KB → 178 KB. The decoder (947 KB WASM, 412 KB gzipped) loads only when the scanner opens. Decoding runs in a worker with one frame in flight; most passes take 10–60 ms, and the slower zoom passes up to about 170 ms.

## H. Deployment

1. Apply the patch on a branch (`git apply smartpick-scanner-fix.patch`), or copy the files. Review, then commit.
2. No environment-variable changes and no database migration are needed.
3. Render's existing build and start commands work unchanged. They were verified on a clean copy.
4. After deploy: sign in, open **Scan ID card**, and check that *Scanner diagnostics → Decoder* says "ready". Then scan your card.

## I. Remaining issues / needs your input

- **Test your physical card.** If it still fails, open *Scanner diagnostics* and tell me the Resolution and Frames decoded, or send a redacted photo of the barcode.
- **Real card attempt (MacBook webcam, VIT card):** not decoded. The barcode was too blurred at the distance it was held. Update 2 adds the built-in-detector pass and the focus tip. Whether Apple Vision reads that card is unverified, because the computer linked to this session is a Windows PC.
- Laptop webcams are often fixed-focus and cannot focus at 10–15 cm. If the barcode looks blurry in the preview, hold the card farther away or use **Upload photo** with a phone picture.
- Camera switching and torch need real devices to verify.
- Production smoke test with the operator password: not performed by me (see the chat for why).
- Case-insensitive matching is a new rule. It only applies when there is no exact match and the result is unique; ambiguous cases return 409. Tell me if registration numbers are case-sensitive at your institution.

## J. Acceptance checklist

| Criterion | Status |
|---|---|
| Scanner root cause traced | ✅ reproduced and fixed |
| Regression tests for the fix | ✅ |
| Supported formats explicitly identified | ✅ (your card's specific format: unverified) |
| Real decode → correct backend lookup | ✅ (synthetic card, local DB) |
| Invalid / unknown identifiers handled | ✅ |
| Camera / API failures give actionable feedback | ✅ |
| Manual fallback works | ✅ |
| Every visible control identified and verified, or marked BLOCKED | ✅ |
| Critical workflows tested | ✅ |
| Production build succeeds | ✅ |
| Accessibility / responsive / perf / security reviewed | ✅ |
| Verified on your physical card and real phone/laptop cameras | ⏳ unverified |
| Verified on the deployed site | ⏳ not deployed, by request |
