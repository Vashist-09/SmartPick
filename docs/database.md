# Existing Neon database

The backend connects to the already provisioned Neon PostgreSQL database through `DATABASE_URL`. It does not create, reset, migrate, or seed schema. The existing tables are `students`, `slots`, `compartments`, `parcels`, `hardware_devices`, `hardware_commands`, `hardware_events`, and `activity_logs`. Existing UUID keys, foreign keys, enums, constraints, and the `updated_at` trigger remain the source of truth.

The physical unit has three slots (`slot_no` 1–3) with two compartments each (`compartment_no` 1–2), plus one ESP32. The `/api/slots` endpoint reads this layout from the database; it does not manufacture missing slots or compartments. Confirm the existing rows match the hardware before using storage assignment or removal events:

```sql
SELECT s.slot_no, COUNT(c.compartment_id) AS compartment_count,
       ARRAY_AGG(c.compartment_no ORDER BY c.compartment_no) FILTER (WHERE c.compartment_id IS NOT NULL) AS compartments
FROM slots s
LEFT JOIN compartments c USING (slot_id)
GROUP BY s.slot_no
ORDER BY s.slot_no;
```

Expected result: three slots, each with compartments `1` and `2`. Do not delete and recreate rows that have parcel history; preserve their IDs and relationships when correcting data. The firmware maps logical slot and compartment numbers to its actual pin driver. No database UUID is a GPIO value. Never expose `DATABASE_URL` in frontend configuration.

## Connected workflow migration

`backend/migrations/001_workflows.sql` is an explicit additive migration. It is never executed by the application. It adds `parcels.workflow_status` (ACTIVE/CANCELLED/RETURNED) without changing the existing parcel enum, and creates:

- `app_accounts`: hashed credentials, email verification, immutable student claim, staff approval and notification preference. Only one approved student account per normalized registration.
- `app_sessions`: hashed random tokens and expiry.
- `app_challenges`: hashed single-use verification/reset tokens and expiry.
- `pickup_attempts`: account, parcel, device command, state and expiry; one active attempt per parcel.
- `app_audit`: actor, parcel, event, details and timestamp.
- `app_notifications`: mail/in-app outbox with retry, delivery and read state. Auth messages are excluded from the inbox.

Workflow-changing transactions use a transaction-scoped advisory lock (`734921`) for this small single-device system, as well as row locks and the unique active-attempt index. All API processes connected to this database use the same lock. Direct database writers and firmware outside this API must respect inventory invariants themselves. Multi-device/high-volume work should replace this coarse lock with a documented lock hierarchy.

Before applying, verify the existing UUID keys, statuses and columns against the backend queries. This repository does not contain the actual provisioned schema. Integration tests use `backend/test/fixture.sql` in a disposable `smartpick_test` database, with one unique schema per test run. The fixture must never be applied to campus data. No automatic migration rollback drops real account or audit data; take a database backup before installation.
