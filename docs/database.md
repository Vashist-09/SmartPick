# Existing Neon database

The backend connects to the already provisioned Neon PostgreSQL database through `DATABASE_URL`. It does not create, reset, migrate, or seed schema. The existing tables are `students`, `slots`, `compartments`, `parcels`, `hardware_devices`, `hardware_commands`, `hardware_events`, and `activity_logs`. Existing UUID keys, foreign keys, enums, constraints, and the `updated_at` trigger remain the source of truth.

The physical unit has three slots with two compartments each and one ESP32. Slots describe the larger unit; compartments are individual one-parcel locations. The firmware maps logical slot and compartment numbers to its actual pin driver. No database UUID is a GPIO value. Never expose `DATABASE_URL` in frontend configuration.
