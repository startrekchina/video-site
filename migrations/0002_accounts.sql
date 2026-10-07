-- All timestamps are UTC Unix milliseconds (INTEGER).
CREATE TABLE users (
  id TEXT PRIMARY KEY NOT NULL,
  username TEXT NOT NULL CHECK (
    length(username) BETWEEN 3 AND 12
    AND username NOT GLOB '*[^A-Za-z0-9_-]*'
  ),
  username_key TEXT NOT NULL UNIQUE CHECK (username_key = lower(username)),
  email TEXT NOT NULL,
  email_key TEXT NOT NULL,
  email_verified_at INTEGER,
  pending_email TEXT,
  pending_email_key TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('member', 'admin')),
  status TEXT NOT NULL CHECK (status IN ('active', 'banned')),
  invited_by_user_id TEXT REFERENCES users (id),
  invite_quota INTEGER NOT NULL CHECK (invite_quota >= 0),
  credential_version INTEGER NOT NULL DEFAULT 0 CHECK (credential_version >= 0),
  auth_failure_count INTEGER NOT NULL DEFAULT 0 CHECK (auth_failure_count >= 0),
  last_auth_failure_at INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (email_key, id) REFERENCES email_claims (email_key, user_id)
    DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (pending_email_key, id) REFERENCES email_claims (email_key, user_id)
    DEFERRABLE INITIALLY DEFERRED,
  CHECK (invited_by_user_id IS NULL OR invited_by_user_id <> id),
  CHECK (
    (pending_email IS NULL AND pending_email_key IS NULL)
    OR (pending_email IS NOT NULL AND pending_email_key IS NOT NULL
      AND email_verified_at IS NOT NULL AND pending_email_key <> email_key)
  )
);
CREATE INDEX users_invited_by_idx ON users (invited_by_user_id);

-- One unique namespace covers both current and pending email keys.
-- Deferred reverse foreign keys prevent removing a claim still referenced by a user.
CREATE TABLE email_claims (
  email_key TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users (id),
  kind TEXT NOT NULL CHECK (kind IN ('current', 'pending')),
  UNIQUE (user_id, kind),
  UNIQUE (email_key, user_id)
);

CREATE TRIGGER email_claims_match_user_insert
BEFORE INSERT ON email_claims
BEGIN
  SELECT RAISE(ABORT, 'Email claim does not match user')
  WHERE NOT EXISTS (
    SELECT 1 FROM users WHERE id = NEW.user_id AND (
      (NEW.kind = 'current' AND email_key = NEW.email_key)
      OR (NEW.kind = 'pending' AND pending_email_key = NEW.email_key)
    )
  );
END;

CREATE TRIGGER email_claims_match_user_update
BEFORE UPDATE ON email_claims
BEGIN
  SELECT RAISE(ABORT, 'Email claim does not match user')
  WHERE NOT EXISTS (
    SELECT 1 FROM users WHERE id = NEW.user_id AND (
      (NEW.kind = 'current' AND email_key = NEW.email_key)
      OR (NEW.kind = 'pending' AND pending_email_key = NEW.email_key)
    )
  );
END;

CREATE TRIGGER users_claim_emails_insert
AFTER INSERT ON users
BEGIN
  INSERT INTO email_claims (email_key, user_id, kind)
    VALUES (NEW.email_key, NEW.id, 'current');
  INSERT INTO email_claims (email_key, user_id, kind)
    SELECT NEW.pending_email_key, NEW.id, 'pending'
    WHERE NEW.pending_email_key IS NOT NULL;
END;

CREATE TRIGGER users_claim_emails_update
AFTER UPDATE OF email_key, pending_email_key ON users
BEGIN
  DELETE FROM email_claims WHERE user_id = NEW.id;
  INSERT INTO email_claims (email_key, user_id, kind)
    VALUES (NEW.email_key, NEW.id, 'current');
  INSERT INTO email_claims (email_key, user_id, kind)
    SELECT NEW.pending_email_key, NEW.id, 'pending'
    WHERE NEW.pending_email_key IS NOT NULL;
END;

CREATE TRIGGER users_invitation_source_immutable
BEFORE UPDATE OF invited_by_user_id ON users
WHEN NEW.invited_by_user_id IS NOT OLD.invited_by_user_id
BEGIN
  SELECT RAISE(ABORT, 'Invitation source is immutable');
END;

CREATE TABLE email_verification_tokens (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users (id),
  purpose TEXT NOT NULL CHECK (purpose IN ('registration', 'email_change')),
  target_email_key TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK (expires_at > created_at),
  consumed_at INTEGER
);
CREATE UNIQUE INDEX email_verification_tokens_unconsumed_user_unique
  ON email_verification_tokens (user_id) WHERE consumed_at IS NULL;
CREATE INDEX email_verification_tokens_revoke_idx
  ON email_verification_tokens (user_id, purpose, consumed_at);
CREATE INDEX email_verification_tokens_expires_idx ON email_verification_tokens (expires_at);

CREATE TABLE email_deliveries (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT REFERENCES users (id),
  to_email_key TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN (
    'registration_verification', 'verification_resend', 'email_change_verification',
    'password_reset', 'admin_notification', 'security_alert'
  )),
  provider_message_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('accepted', 'failed', 'unknown')),
  error_code TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX email_deliveries_quota_idx
  ON email_deliveries (to_email_key, purpose, created_at);

CREATE TABLE invitations (
  id TEXT PRIMARY KEY NOT NULL,
  code_hash TEXT NOT NULL UNIQUE,
  issuer_user_id TEXT REFERENCES users (id),
  used_by_user_id TEXT UNIQUE REFERENCES users (id),
  operation_id TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK (expires_at > created_at),
  revoked_at INTEGER,
  used_at INTEGER,
  CHECK ((used_by_user_id IS NULL) = (used_at IS NULL)),
  CHECK (issuer_user_id IS NULL OR issuer_user_id <> used_by_user_id),
  CHECK (issuer_user_id IS NULL OR operation_id IS NOT NULL)
);
CREATE INDEX invitations_issuer_created_idx ON invitations (issuer_user_id, created_at);
CREATE UNIQUE INDEX invitations_issuer_operation_unique
  ON invitations (issuer_user_id, operation_id) WHERE issuer_user_id IS NOT NULL;
