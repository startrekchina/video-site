-- All timestamps are UTC Unix milliseconds (INTEGER).
-- Authentication-library integration may add tables in a later migration after T2.4.
CREATE TABLE sessions (
  id TEXT PRIMARY KEY NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES users (id),
  credential_version INTEGER NOT NULL CHECK (credential_version >= 0),
  device_description TEXT,
  created_at INTEGER NOT NULL,
  last_active_at INTEGER NOT NULL CHECK (last_active_at >= created_at),
  expires_at INTEGER NOT NULL CHECK (expires_at > created_at),
  revoked_at INTEGER
);
CREATE INDEX sessions_user_expires_idx ON sessions (user_id, expires_at);

CREATE TABLE recovery_codes (
  code_hash TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users (id),
  generation INTEGER NOT NULL CHECK (generation >= 0),
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  used_at INTEGER,
  CHECK (expires_at IS NULL OR expires_at > created_at)
);
CREATE INDEX recovery_codes_user_generation_idx ON recovery_codes (user_id, generation);
CREATE INDEX recovery_codes_expires_idx ON recovery_codes (expires_at);

CREATE TABLE reset_links (
  id TEXT PRIMARY KEY NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES users (id),
  source TEXT NOT NULL CHECK (source IN ('email', 'admin')),
  issuer_admin_user_id TEXT REFERENCES users (id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK (expires_at > created_at),
  consumed_at INTEGER,
  CHECK (
    (source = 'email' AND issuer_admin_user_id IS NULL)
    OR (source = 'admin' AND issuer_admin_user_id IS NOT NULL)
  )
);
-- Time-dependent validity is checked by conditional writes; replacement retires the old row first.
CREATE UNIQUE INDEX reset_links_unconsumed_user_unique
  ON reset_links (user_id) WHERE consumed_at IS NULL;
CREATE INDEX reset_links_revoke_idx ON reset_links (user_id, consumed_at);
CREATE INDEX reset_links_expires_idx ON reset_links (expires_at);

CREATE TABLE totp_credentials (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES users (id),
  encrypted_secret BLOB NOT NULL,
  nonce BLOB NOT NULL,
  key_version INTEGER NOT NULL CHECK (key_version > 0),
  last_accepted_step INTEGER CHECK (last_accepted_step >= 0),
  created_at INTEGER NOT NULL,
  enabled_at INTEGER
);

CREATE TABLE passkeys (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users (id),
  credential_id TEXT NOT NULL UNIQUE,
  public_key BLOB NOT NULL,
  counter INTEGER NOT NULL CHECK (counter >= 0),
  device_type TEXT NOT NULL CHECK (device_type IN ('single_device', 'multi_device')),
  backed_up INTEGER NOT NULL CHECK (backed_up IN (0, 1)),
  transports TEXT,
  device_description TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX passkeys_user_idx ON passkeys (user_id);

CREATE TABLE auth_challenges (
  id TEXT PRIMARY KEY NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('csrf', 'totp', 'webauthn')),
  operation TEXT NOT NULL,
  user_id TEXT REFERENCES users (id),
  session_id TEXT REFERENCES sessions (id),
  target_user_id TEXT REFERENCES users (id),
  payload TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK (expires_at > created_at),
  consumed_at INTEGER
);
CREATE INDEX auth_challenges_user_idx ON auth_challenges (user_id, operation, consumed_at);
CREATE INDEX auth_challenges_expires_idx ON auth_challenges (expires_at);

-- Timestamp buckets preserve exact sliding windows, including attempts sharing a millisecond.
-- Keys are irreversible digests or opaque member identifiers, never raw anonymous credentials.
CREATE TABLE rate_limit_counters (
  key TEXT NOT NULL,
  operation TEXT NOT NULL,
  occurred_at INTEGER NOT NULL,
  count INTEGER NOT NULL CHECK (count > 0),
  expires_at INTEGER NOT NULL CHECK (expires_at > occurred_at),
  PRIMARY KEY (key, operation, occurred_at)
);
CREATE INDEX rate_limit_counters_expires_idx ON rate_limit_counters (expires_at);
