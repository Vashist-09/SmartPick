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
