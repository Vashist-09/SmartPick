-- LOCAL TEST SCHEMA ONLY.
-- Reconstructed from the queries in backend/src so the API can be integration-tested
-- against a throwaway local PostgreSQL. It is NOT a migration and must never be run
-- against the production Neon database (which remains the source of truth).
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DROP TABLE IF EXISTS activity_logs, hardware_events, hardware_commands, parcels, compartments, slots, students, hardware_devices CASCADE;

CREATE TABLE students (
  student_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_no varchar(64) NOT NULL UNIQUE,
  student_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE TABLE slots (
  slot_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_no int NOT NULL UNIQUE,
  slot_name text NOT NULL,
  slot_status text NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE TABLE compartments (
  compartment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_id uuid NOT NULL REFERENCES slots(slot_id),
  compartment_no int NOT NULL,
  occupancy_status text NOT NULL DEFAULT 'EMPTY',
  UNIQUE (slot_id, compartment_no)
);
CREATE TABLE parcels (
  parcel_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tracking_id text NOT NULL UNIQUE,
  student_id uuid NOT NULL REFERENCES students(student_id),
  parcel_status text NOT NULL,
  payment_type text NOT NULL,
  payment_status text NOT NULL,
  compartment_id uuid REFERENCES compartments(compartment_id),
  stored_at timestamptz,
  collected_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE hardware_devices (
  device_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_status text NOT NULL DEFAULT 'OFFLINE',
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE TABLE hardware_commands (
  command_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id uuid NOT NULL REFERENCES hardware_devices(device_id),
  parcel_id uuid REFERENCES parcels(parcel_id),
  compartment_id uuid REFERENCES compartments(compartment_id),
  command_type text NOT NULL,
  command_status text NOT NULL,
  acknowledged_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE hardware_events (
  event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id uuid NOT NULL REFERENCES hardware_devices(device_id),
  source_event_key varchar(100) NOT NULL,
  parcel_id uuid REFERENCES parcels(parcel_id),
  compartment_id uuid REFERENCES compartments(compartment_id),
  event_type text NOT NULL,
  processing_status text NOT NULL,
  occurred_at timestamptz,
  processed_at timestamptz,
  UNIQUE (device_id, source_event_key)
);
CREATE TABLE activity_logs (
  log_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parcel_id uuid, student_id uuid, slot_id uuid, compartment_id uuid, device_id uuid,
  event_type text NOT NULL,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

-- Synthetic fixtures (fictional people / identifiers only).
INSERT INTO hardware_devices (device_status) VALUES ('OFFLINE');
INSERT INTO slots (slot_no, slot_name) VALUES (1,'Slot 1'),(2,'Slot 2'),(3,'Slot 3');
INSERT INTO compartments (slot_id, compartment_no)
  SELECT slot_id, n FROM slots CROSS JOIN generate_series(1,2) n;
