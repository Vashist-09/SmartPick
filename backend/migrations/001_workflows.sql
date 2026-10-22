-- Apply explicitly against a backed-up existing SmartPick database. Never run at startup.
BEGIN;
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS workflow_status text NOT NULL DEFAULT 'ACTIVE'
  CHECK (workflow_status IN ('ACTIVE','CANCELLED','RETURNED'));
CREATE TABLE IF NOT EXISTS app_accounts (
 account_id uuid PRIMARY KEY, email text UNIQUE NOT NULL, registration_no text,
 full_name text NOT NULL, phone text NOT NULL DEFAULT '', password_hash text NOT NULL,
 role text NOT NULL DEFAULT 'STUDENT' CHECK (role IN ('STUDENT','OPERATOR')),
 email_verified_at timestamptz, approved_at timestamptz, approved_by uuid REFERENCES app_accounts,
 notifications_enabled boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS app_one_approved_identity ON app_accounts(registration_no) WHERE approved_at IS NOT NULL AND role='STUDENT';
CREATE TABLE IF NOT EXISTS app_sessions (
 token_hash text PRIMARY KEY, account_id uuid NOT NULL REFERENCES app_accounts ON DELETE CASCADE,
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS app_challenges (
 token_hash text PRIMARY KEY, account_id uuid NOT NULL REFERENCES app_accounts ON DELETE CASCADE,
 purpose text NOT NULL CHECK (purpose IN ('VERIFY','RESET')), expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS pickup_attempts (
 pickup_id uuid PRIMARY KEY, parcel_id uuid NOT NULL REFERENCES parcels,
 account_id uuid REFERENCES app_accounts, command_id uuid REFERENCES hardware_commands,
 status text NOT NULL CHECK (status IN ('ACTIVE','COLLECTED','FAILED','CANCELLED','EXPIRED')),
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS pickup_one_active ON pickup_attempts(parcel_id) WHERE status='ACTIVE';
CREATE TABLE IF NOT EXISTS app_audit (
 audit_id uuid PRIMARY KEY, account_id uuid REFERENCES app_accounts, parcel_id uuid REFERENCES parcels,
 event_type text NOT NULL, details jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS app_notifications (
 notification_id uuid PRIMARY KEY, account_id uuid REFERENCES app_accounts, parcel_id uuid REFERENCES parcels,
 destination text NOT NULL, subject text NOT NULL, body text NOT NULL, kind text NOT NULL,
 status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','SENDING','SENT','FAILED')),
 attempts integer NOT NULL DEFAULT 0, available_at timestamptz NOT NULL DEFAULT now(),
 locked_at timestamptz, read_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(account_id,parcel_id,kind)
);
CREATE INDEX IF NOT EXISTS app_sessions_expiry ON app_sessions(expires_at);
CREATE INDEX IF NOT EXISTS app_notifications_pending ON app_notifications(status,available_at);
CREATE INDEX IF NOT EXISTS app_audit_parcel ON app_audit(parcel_id,created_at);
COMMIT;
