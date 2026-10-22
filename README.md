# SmartPick

Campus parcel registration, storage and verified pickup with an ESP32 compartment light and removal sensor.

There are three applications:

- **Student app at the repository root:** connected account registration, email verification, staff identity approval, owned parcels, pickup tracking/receipts, recovery, profile, activity and notifications.
- **Operator app in `frontend/`:** individual staff login, inbound registration/queue/storage, student identity approval/correction, payment settlement, pickup tracking, returns/cancellation/manual collection and activity.
- **API in `backend/`:** Express/TypeScript, PostgreSQL, cookie sessions, mail outbox and device HTTP contract.

The original browser-only prototype remains available at `http://localhost:5173/?demo=1`. It has no secure accounts or real parcel data. Its storage is separate from the connected app.

## Setup

Requires Node.js 20+ and an existing SmartPick PostgreSQL database. No schema changes or staff account creation happen at server startup.

1. Install independently with `npm ci --prefix backend` and `npm ci --prefix frontend`.
2. Copy `backend/.env.example` to `backend/.env` and set the database, allowed origins, student app origin and distinct device key.
3. Back up the existing database and explicitly apply [backend/migrations/001_workflows.sql](backend/migrations/001_workflows.sql) using your PostgreSQL client. The migration adds account/session/challenge, pickup, audit and notification tables and `parcels.workflow_status`. It preserves existing parcel enums and rows. Compare the existing schema with [docs/database.md](docs/database.md) first.
4. Create an operator account explicitly from `backend/` using `STAFF_EMAIL=... STAFF_PASSWORD=... npm run provision:operator`. Supply these as environment variables through your secret manager or a local shell; do not commit them. Passwords require at least 12 characters. The CLI creates an account and does not overwrite an existing one.
5. Configure real email delivery, or enable the development mailbox for a **local sample-data environment only**, as described below.
6. Run the three apps in separate terminals:

```sh
# root student app, http://localhost:5173
npm run dev

# API, http://localhost:5050
cd backend
npm run dev

# operator desk, http://localhost:5174
cd frontend
npm run dev -- --port 5174 --strictPort
```

The student server and operator Vite server proxy `/api` to `http://127.0.0.1:5050`. Use the hostname `localhost` consistently with the example CORS settings. The operator app no longer ships a shared API key. Student and staff sessions use separate HttpOnly cookies so both apps can be used on localhost without replacing each other's sessions.

Check `GET /api/health/ready` after setup. It returns 503 if the database workflow setup is incomplete. `/api/health` checks the process; `/api/health/db` checks the database connection.

## Student verification and collection

Register → email link → email verified → staff checks campus ID and approves the student mapping → My parcels → parcel details → start pickup → waiting for device → light activated → sensor-confirmed collection → receipt.

Email verification grants a session, but cannot grant access to an arbitrary typed registration number. Staff approval requires a single matching existing student record. Multiple unapproved accounts may claim the same registration number; only one can be approved. The first parcel registration creates the campus inventory student record if needed. Staff must compare actual ID evidence; an inventory row alone is not identity proof.

Students can only read their own parcels/activity and pickup attempts. Identity/email changes go through the desk, revoke sessions and require renewed approval. Changed emails require verification again. Profile name, optional phone and ready-email preference are editable by the student.

COD settlement is recorded by staff with a receipt/reference before pickup can start. The app does not charge cards or integrate a payment processor. Proxy collection remains a staff decision recorded in the verification note; students cannot authorize another account themselves.

The operator desk retains camera barcode scanning with manual entry. Scanning selects a student lookup; staff still record a collector identity check. The scanner in the old demo remains a placeholder. The connected app uses the verified student's parcel list instead of treating a scanned registration number as authentication.

## Email delivery

Set `MAIL_WEBHOOK_URL` to a trusted **HTTPS** transactional-email gateway and `MAIL_WEBHOOK_KEY` to its server-only bearer key. The worker posts:

```json
{"to":"student@example.test","subject":"Your parcel is ready","text":"...","idempotencyKey":"notification-uuid"}
```

The gateway must honor `idempotencyKey` and return 2xx only once it accepts delivery. This adapter does not assume a particular email vendor. No real emails can be delivered until a gateway is configured. The worker retries up to five times with a five-minute delay. Notification failure does not undo parcel storage. Operators can retry failed parcel/approval notifications; verification/reset links are resent through auth flows. In-app notifications never expose verification/reset links.

For local development with fake accounts, set `ENABLE_DEV_MAILBOX=true` and keep `NODE_ENV` different from `production`. Inspect `GET /api/auth/dev-mailbox?email=student%40example.test` to get a sample verification/reset link. This endpoint requires a loopback connection and returns 404 in production. Never enable it behind a publicly accessible development proxy.

Verification/reset links expire in 30 minutes, are single-use, and are hashed in the challenge table. Delivery content temporarily contains the link so the outbox can send it; consumed/expired links are scrubbed. Resend has a 60-second cooldown. Password reset revokes all sessions and requires a fresh login.

## Pickup and device reliability

Parcel state remains `REGISTERED → STORED → COLLECTED`. Administrative cancellation/return uses a separate workflow state. A light executing does **not** mark a parcel collected or free a compartment.

An active pickup lasts five minutes. Device heartbeat is current for 30 seconds. Acknowledged commands that do not report a result within 30 seconds fail; a new attempt requires an explicit retry. There is no blind automatic replay of uncertain hardware execution. Each parcel permits at most three pickup attempts per 15 minutes.

Collection/return/cancellation retires pending commands. Dispatch checks current parcel, compartment, pickup and payment eligibility. Duplicate requests resume an active attempt; repeated identical command results and removal-event keys are idempotent. Pickup URLs survive refresh. Unexpected sensor removal still records physical inventory truth and creates an `UNEXPECTED_REMOVAL` audit event for staff, including unpaid COD exceptions.

See [backend/ESP32_API.md](backend/ESP32_API.md) for firmware behavior and [docs/api.md](docs/api.md) for API routes.

## Tests and builds

```sh
# Existing local demo tests, independent of backend dependencies
npm test
npm run build:student

# Backend build and integration suite (suite skips without TEST_DATABASE_URL)
npm run build --prefix backend
TEST_DATABASE_URL=postgresql://.../smartpick_test npm test --prefix backend

# Operator build
npm run build --prefix frontend
```

Integration tests refuse database names other than `smartpick_test`. They create a unique temporary schema, load a **test-only** model of the existing schema, apply the migration twice, test flows, and remove that schema afterward. They do not verify the undisclosed production schema. Use only a disposable database; the fixture is not a production migration.

Coverage includes verification and access gating, ownership, staff-only changes, COD/offline eligibility, concurrent storage/pickups, command timeout, duplicate events/results, collection, unexpected removal, cancellation/expiry/returns/manual override, profile preferences, notification isolation/retries and password-reset session revocation.

A local browser preview can be seeded with `TEST_DATABASE_URL=.../smartpick_test npm run preview:seed --prefix backend`. Start the backend with that database and PostgreSQL `search_path=preview,public`. The disposable accounts are `desk@example.test` and `student@example.test`, both with password `SmartPick preview 2026`. Start `npm run simulate:device --prefix backend` with the same local `TEST_DATABASE_URL` to simulate light execution and removal after 12 seconds. The simulator only handles parcel IDs present in the preview fixture when it starts; restart it after adding sample parcels.

## Deployment

Build outputs are `dist/`, `backend/dist/` and `frontend/dist/`. The backend serves the operator build at `/` and the student build at `/student/`, preserving the Render deployment. Set `STUDENT_APP_ORIGIN` to `https://YOUR-HOST/student` for those verification links. Root `npm run build` builds all three apps. Alternatively, deploy both frontends with an `/api` reverse proxy to the backend; the root static build alone cannot serve connected APIs. The root `server.mjs` is a local development server and serves source files. Set `NODE_ENV=production`, HTTPS, exact comma-separated `CORS_ORIGIN` values, `STUDENT_APP_ORIGIN`, device key and mail gateway secrets. Host apps and API on the same site for SameSite=Lax cookies. Never copy database/device/mail credentials into frontend configuration.

Before rollout, apply the migration against a backup/staging copy of the actual schema and test the physical device. No existing database credentials, real email service or firmware were available during implementation.

The included rate limiter is process-local and keys by socket address. For multiple server instances or a shared reverse proxy, add a shared rate limiter at the trusted ingress with the correct client-IP configuration. The physical prototype still has one ESP32: routes intentionally target the first configured device. Multi-device enrollment/permissions and automatic door unlocking are outside this hardware contract.
