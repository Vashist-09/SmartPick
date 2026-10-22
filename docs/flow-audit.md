# SmartPick flow and endpoint audit

Historical audit. See [implementation status](implementation-status.md) for the work completed afterward.

Reviewed 22 October 2026. This is a source review of the student app, operator app, backend, database notes, device contract and existing tests. Proposed routes below do not exist yet. No live database, email service or physical hardware was exercised.

## Current experience

| Area | Implemented | Missing continuation |
| --- | --- | --- |
| Student account | Local demo registration/login, profile, settings, sign-out | Real identity verification, server session, recovery, account ownership |
| Student lookup | Mock ID lookup, location display, local activity | Own parcels from API, multiple parcels, pickup request, current status |
| Operator inbound | Register parcel, search registered parcels, assign compartment | Direct handoff from registration to storage, inbound queue, correction/cancellation |
| Operator outbound | Search student, select stored parcel, queue light | Identity verification, payment handling, command progress, collection confirmation |
| Hardware | Poll command, report result, report removal | Recovery after lost command, expiry, frontend status, exception resolution |

Student routes currently are `#home`, `#scan`, `#activity`, `#result`, `#login`, `#register`, `#forgot`, `#profile`, `#settings`. The operator app is one dashboard. Unknown student hashes silently show Home. A direct/reloaded result has no persisted result and shows a lookup prompt.

## What happens after verification?

There is currently no verification endpoint or page. Registration immediately starts a local demo session and goes Home (`src/app.js`, account submit handler). Reading an ID barcode also does not prove ownership of the ID. Account verification and approval to collect a parcel need separate rules.

### Proposed account verification journey

1. Register through the selected identity provider or server auth service. Show a pending verification screen, with masked destination and resend control. Do not grant student API access yet.
2. Verify the email link/code. Define how the verified account is bound to a campus registration number; an arbitrary email plus a typed registration number is insufficient evidence of ownership.
3. On success, consume the challenge once and establish or refresh a server session. A success page continues to **My parcels**, or a previously requested page after checking access again.
4. Show ready parcels, parcels awaiting storage, and an explicit empty state. Do not leave the student on a generic “verified” screen.
5. Handle expired, invalid, already-used and superseded links, resend cooldown, too many attempts, already-verified accounts, a link opened in another browser, and session expiry. Changing a verified email requires re-verification; changing a campus identity needs a controlled process.

Candidate pages: `/verify-email`, `/verification-complete`, `/my-parcels`, `/parcels/:parcelId`, `/pickup/:pickupId`, `/pickup/:pickupId/complete`, `/help`, `/reset-password`. These are product proposals, not existing URLs.

### Proposed parcel collection journey

1. Student opens an owned parcel, or staff selects a parcel and verifies the collector under the agreed campus procedure.
2. Server checks parcel ownership/approved staff action, STORED status, active location, payment policy and device availability.
3. Create a pickup attempt and queue the compartment light. Show **Waiting for device**, then **Light activated** only after an executed result. This hardware contract controls a light; it does not unlock a door.
4. Show slot and compartment, then **Waiting for collection**. Keep parcel inventory state STORED until confirmed removal.
5. A valid removal event changes the parcel to COLLECTED and releases the compartment. Show completion time, a receipt/reference, remaining parcels and a return action.
6. If the device fails, stays offline, or no removal arrives, show a timeout and staff-help path. A cancellation/expired attempt must not itself mark the parcel collected or free the compartment.

Keep parcel state (`REGISTERED → STORED → COLLECTED`), hardware command state and pickup attempt state separate. Executing a light command is not proof of collection. A repeated request should resume the same active attempt.

## Existing HTTP endpoints

| Method | Path | Access / behavior |
| --- | --- | --- |
| GET | `/api/health` | Public process health |
| GET | `/api/health/db` | Public database reachability |
| GET | `/api/slots` | Operator key; inventory map |
| POST | `/api/parcels` | Operator key; register parcel |
| POST | `/api/parcels/:parcelId/store` | Operator key; assign empty compartment |
| GET | `/api/students/:registrationNo/parcels` | Operator key; all parcels for registration |
| POST | `/api/parcels/:parcelId/retrieve` | Operator key; queue/reuse light command, 202 |
| GET | `/api/device/commands/next` | Device key; claim pending command |
| POST | `/api/device/commands/:commandId/result` | Device key; executed/failed result |
| POST | `/api/device/events` | Device key; removal event, deduplicated by source key |

`backend/src/server.ts` mounts the same parcel router at `/api/parcels` and `/api/students`, unintentionally exposing aliases for all four parcel handlers, including `POST /api/students` and `/api/students/:parcelId/retrieve`. Split student lookup into its own router for a clear API contract.

## Missing endpoints to design

Route names are illustrative. Auth-provider choice and schema review should precede implementation; the existing database must not be implicitly migrated.

| Priority | Proposed API | Purpose |
| --- | --- | --- |
| First | Auth register/login/logout/session; verification challenge/confirm/resend | Real account lifecycle; provider-managed equivalents are acceptable |
| First | Auth recovery request/reset | Expiring, single-use recovery; generic responses to avoid disclosing account existence |
| First | `GET /api/me`, `PATCH /api/me` | Session identity and permitted profile changes |
| First | `GET /api/me/parcels`, `GET /api/me/parcels/:parcelId` | Server-scoped own parcels; never trust a supplied registration number as authorization |
| First | `POST /api/parcels/:parcelId/pickups` | Check eligibility and create/reuse pickup attempt |
| First | `GET /api/pickups/:pickupId` | Authorized polling for command, timeout and collection state |
| First | `GET /api/commands/:commandId` | Operator command diagnostics; may be folded into pickup response |
| First | `GET /api/devices/status` | Heartbeat age and usable device status |
| Next | `GET /api/parcels?status=REGISTERED` | Recoverable operator inbound queue with pagination |
| Next | Operator payment update endpoint | Record COD settlement/reference with audit trail; no client-declared payment acceptance |
| Next | Pickup cancel/retry and exception-resolution endpoints | Bounded retries, authorized intervention, reason and audit trail |
| Next | Parcel correction/cancellation/return endpoints | Wrong recipient, duplicate entry, damaged parcel, unclaimed return; legal transitions only |
| Next | `GET /api/me/activity`, operator activity endpoint | Real history, ownership scope, pagination |
| Later | Notifications and preferences | Parcel-ready notification after storage, retryable delivery, read state |

Every protected resource needs role/ownership checks. Add consistent JSON errors, appropriate 400/401/403/404/409/429/503 responses, request limits and timeouts, and idempotency for retried writes. Keep operator/device credentials out of the student bundle.

## Concrete gaps found in current code

### Resolve before a real student rollout

- **No real student identity or API integration.** Demo credentials are deliberately unverified and accounts/activity use browser storage. Registration number edits cannot become an authorization mechanism. Source: `src/app.js`, `src/data.js`, `backend/src/middleware/auth.ts`.
- **Pickup eligibility ignores COD payment.** Retrieval checks only STORED, and the list response omits payment state. Unpaid COD can currently queue a light. Add a settlement path and server enforcement if campus policy requires payment before pickup. Source: `backend/src/routes/parcels.ts:40–55`, `backend/src/schemas.ts`.
- **Acknowledged commands can remain stuck forever.** Polling claims a command before delivery is known; a lost response leaves it ACKNOWLEDGED. Retrieval keeps returning that command, with no lease or recovery. Terminal result retries also return 409 rather than replaying the accepted result. Source: `backend/src/routes/device.ts:10–27`; documented in `backend/ESP32_API.md`.
- **Queued commands can outlive collection.** Removal changes parcel/occupancy but does not close pending commands. Polling does not recheck parcel state, so a stale command can later light a location that may have been reassigned. Retire obsolete work and validate eligibility at dispatch. Source: `backend/src/routes/device.ts:14,42–45`.
- **Removal is not tied to a verified pickup attempt.** A matching STORED parcel plus occupied compartment is enough to collect it. Decide whether spontaneous removal is accepted inventory truth and flagged as an exception, or requires an active authorized pickup. Source: `backend/src/routes/device.ts:38–45`.
- **Shared operator key is embedded in the browser build.** This is documented demo behavior, not individual staff login or accountable authorization. Move to staff sessions/roles before wider access. Source: `frontend/src/api.ts`.

### Complete the day-to-day experience

- **Registration ends without storage handoff.** The returned parcel ID is discarded and staff must type the student ID again. Carry the newly registered parcel into assignment and retain an inbound queue. Source: `frontend/src/components/ParcelRegistration.tsx`.
- **Retrieval stops at “queued.”** There is no command read API, completion page, failure countdown or collection receipt. Source: `frontend/src/components/ParcelRetrieval.tsx`.
- **Selections and notices go stale.** Looking up another student does not clear the selected retrieval parcel; changing the selected parcel does not clear the previous command message. Inventory refresh updates slots, not lookup rows or selected parcel. Clear/revalidate selection and associate status with its parcel. Source: `frontend/src/components/StudentLookup.tsx`, `ParcelRetrieval.tsx`, `frontend/src/App.tsx`.
- **Lookup has no distinct empty result/loading state.** Zero results shows the initial instruction, failed lookups retain old rows, and overlapping requests can overwrite a newer result. Collected parcels with retained location show a historical location without explaining it. Source: `frontend/src/components/StudentLookup.tsx`.
- **Registration/retrieval lack an in-flight guard.** Repeat clicks can issue concurrent requests. Retrieval deduplicates active commands server-side, but duplicate terminal requests can create later commands. Use pending controls and intentional retry semantics. Source: operator registration/retrieval components.
- **Student history is a snapshot.** Reopening a FOUND lookup still says ready, without checking collection or reassignment. History is shared across demo sessions. Use live owned parcel records for real accounts. Source: `src/app.js`, activity and result handlers.
- **Location models disagree.** Demo locations A-04/B-12/C-02 do not map to the documented physical three slots with two compartments each. Align labels and data when integrating. Source: `src/data.js`, `docs/database.md`.
- **Identity normalization differs.** Student forms normalize registration case; backend registration trims but lookup compares the raw path case-sensitively. Normalize consistently after confirming campus ID rules. Source: `src/data.js`, `backend/src/schemas.ts`, `backend/src/routes/parcels.ts`.
- **Online means API success in the operator UI.** It does not mean ESP32 is online; backend marks a polling device online but provides no heartbeat expiry/read endpoint. Source: `frontend/src/App.tsx`, `backend/src/routes/device.ts`.
- **Errors need a contract.** Unknown API routes use Express defaults; JSON parsing errors reach a handler that always returns 500. Distinguish malformed JSON, oversized bodies, unknown endpoints and internal failures. Source: `backend/src/server.ts`.

## Additional branches to include in product design

Multiple parcels for one student; registered but not stored; no compartments available; inactive compartment; duplicate tracking ID; wrong student assignment; parcel missing despite occupied sensor; sensor false positive; light failure; network loss after request; browser refresh during pickup; two staff selecting the same parcel; student session expiring mid-pickup; partial collection of several parcels; unpaid COD; collecting for someone else; unclaimed/returned parcels; support escalation; accessible manual entry when scanning fails; notification failure without rolling back storage.

Define campus policies for collector identity, proxy collection, COD settlement and manual collection overrides before exposing those paths. These are unresolved product decisions, not implemented behavior.

## Recommended implementation order

1. Define account and collector verification policies, identity mapping, and auth provider. Build verified-session → owned parcel list with empty/error states.
2. Add parcel details and pickup attempt/status contract; connect command execution and sensor confirmation to progress/completion screens.
3. Implement stale command cleanup, heartbeat expiry, bounded delivery recovery and payment eligibility. Test retries and concurrency against a test database and device simulator.
4. Join operator registration to storage; fix stale lookup/selection behavior; add recovery queue and audited exception handling.
5. Add notifications, real activity, account recovery and remaining operational branches.

## Validation performed

- Root `npm test`: 16 tests passed. Coverage is demo account validation/handlers and mock lookup, not real auth or hardware integration.
- Root `npm run build`: passed.
- Backend `npm run build`: passed.
- Operator `npm run build`: passed.
- No live database, hardware or browser interaction was tested. Backend/operator have no test scripts. Passing compilation does not validate SQL against the provisioned schema.
