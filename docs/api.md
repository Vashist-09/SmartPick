# Connected API contract

All responses are JSON. Errors use `{ "error": "Human-readable message", "code": "MACHINE_CODE" }`. Protected resources return 401 for a missing/expired session, 403 for the wrong role or unverified/unapproved identity, and 404 for a parcel outside the student's ownership. Invalid inputs return 400, state conflicts 409, limits 429 and offline devices 503. Unknown API routes return JSON 404. Request JSON is limited to 32 KB.

Browser writes must send an `Origin` in `CORS_ORIGIN`. Use cookie credentials and HTTPS in production. Student cookie: `smartpick_session`; operator cookie: `smartpick_operator`. The operator client sends `x-smartpick-client: operator` on auth and API requests. This header only selects the cookie namespace; authorization still checks the stored account role. Shared operator API keys are no longer accepted.

## Auth

| Method | Path | Body / response |
| --- | --- | --- |
| POST | `/api/auth/register` | `{email,password,fullName,registrationNo,phone?}`; generic 202; no session until verification/login |
| POST | `/api/auth/login` | `{email,password}`; creates 12-hour session cookie |
| POST | `/api/auth/logout` | Revokes selected session; clears cookie |
| GET | `/api/auth/session` | Account safe fields; no hashes or secrets |
| POST | `/api/auth/resend` | `{email}`; generic 202, at most one new verification challenge per minute |
| POST | `/api/auth/verify` | `{token}`; consumes link and creates session; staff approval still required |
| POST | `/api/auth/forgot` | `{email}`; generic 202 |
| POST | `/api/auth/reset` | `{token,password}`; consumes link, changes password and revokes all sessions |
| GET | `/api/auth/dev-mailbox?email=...` | Local-development-only sample links; unavailable in production |

Password length: 12–128 characters. Tokens: 64 hexadecimal characters, 30-minute expiry. Emails normalize lowercase and registration numbers uppercase. The account email and campus identity are distinct; approval is not automatic.

## Student

| Method | Path | Behavior |
| --- | --- | --- |
| GET / PATCH | `/api/me` | Safe account / `{fullName,phone,notificationsEnabled}`; immutable email/registration |
| GET | `/api/me/parcels?page=0` | Own deliveries, up to 50 per page; verified/approved students only |
| GET | `/api/me/parcels/:parcelId` | Current owned parcel detail, payment, location and timestamps |
| GET | `/api/me/activity?page=0` | Own parcel audit events, 50 per page |
| GET | `/api/me/notifications` | Latest 50 non-auth inbox items |
| POST | `/api/me/notifications/:notificationId/read` | Idempotent read marking; ownership scoped |

Parcel responses use snake_case including `parcel_id`, `tracking_id`, `parcel_status`, `workflow_status`, `payment_type`, `payment_status`, `slot_no`, `compartment_no`, `stored_at`, `collected_at`. Workflow states: ACTIVE, CANCELLED, RETURNED.

## Pickup (student owner or staff)

| Method | Path | Behavior |
| --- | --- | --- |
| POST | `/api/parcels/:parcelId/pickups` | Create/reuse active attempt; 202 `{pickup_id}` |
| GET | `/api/pickups/:pickupId` | Pickup/command/parcel status, location, expiry/completion timestamps |
| POST | `/api/pickups/:pickupId/cancel` | `{reason}`; closes active attempt without collecting/freeing inventory |

For staff, starting pickup also requires `{collectorVerified:true,verificationNote:"Campus ID checked ..."}`. The note is audited. Students need verified and approved ownership. Eligibility requires active STORED parcel, occupied compartment in an active slot, COD paid, device seen within 30 seconds. Attempts expire in five minutes, with three attempts per parcel per 15 minutes.

Attempt states: ACTIVE, COLLECTED, FAILED, CANCELLED, EXPIRED. Command states: PENDING, ACKNOWLEDGED, EXECUTED, FAILED. Show activation only on EXECUTED, completion only on COLLECTED. The acknowledged-result deadline is 30 seconds. Terminal attempts require explicit retries. Physical removal after cancellation/expiry is tracked as an unexpected-removal exception.

## Operator

| Method | Path | Body / behavior |
| --- | --- | --- |
| GET | `/api/slots` | Current inventory; excludes returned/cancelled occupants |
| GET | `/api/parcels?status=REGISTERED&page=0` | Active queue, 50 per page; also STORED/COLLECTED filters |
| GET | `/api/parcels/:parcelId` | Current operator parcel detail for selection revalidation |
| POST | `/api/parcels` | `{registrationNo,studentName,trackingId,paymentType}`; 201 parcel |
| POST | `/api/parcels/:parcelId/store` | `{compartmentId}`; atomically occupy location and enqueue ready notice |
| POST | `/api/parcels/:parcelId/retrieve` | Compatibility route for creating pickup; same staff ID evidence requirement |
| POST | `/api/parcels/:parcelId/payment` | `{reference}`; staff records COD settlement; cannot settle a collected/returned/cancelled parcel |
| PATCH | `/api/parcels/:parcelId` | `{registrationNo,reason}`; correct recipient before storage; requires one existing student record |
| POST | `/api/parcels/:parcelId/resolve` | `{action,reason}`; CANCEL registered parcel, RETURN stored parcel, MANUAL_COLLECT stored/paid parcel |
| GET | `/api/operator/students/:registrationNo/parcels` | Latest 100 deliveries for normalized registration |
| GET | `/api/operator/accounts/pending` | Latest pending student mappings, up to 100 |
| POST | `/api/operator/accounts/:accountId/approve` | `{reason}`; verified email, physical ID evidence, exactly one inventory identity, no other approved claimant |
| GET | `/api/operator/accounts/find?email=...` | Find a student account for correction |
| PATCH | `/api/operator/accounts/:accountId/identity` | `{email,registrationNo,reason}`; revokes sessions/approval; new email needs verification |
| GET | `/api/operator/devices/status` | Heartbeat timestamps and computed online status |
| GET | `/api/operator/commands/:commandId` | Command diagnostic timestamps/status |
| GET | `/api/operator/activity?page=0` | Latest 50 audit events including unexpected removal |
| GET | `/api/operator/notifications` | Latest 50 non-auth delivery statuses |
| POST | `/api/operator/notifications/:notificationId/retry` | Requeue failed parcel/approval email |

A reason/reference is required for consequential staff changes. Manual collection is an explicit audited override for sensor failure after identity/payment checks. Returns/cancellations/manual collection never automatically settle payment. Corrections do not silently rename the campus inventory student record.

## Device

See [ESP32 contract](../backend/ESP32_API.md). Device routes use `x-device-key`, never browser cookies. They are exempt from browser Origin validation. Health routes are public; `/api/health/ready` additionally checks the workflow schema.
