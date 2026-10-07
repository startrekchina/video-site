-- Business timestamps remain UTC Unix milliseconds; native auth dates remain ISO 8601 text.
-- Refuse to discard legacy identities or credentials that have not been reviewed and converted.
CREATE TABLE auth_migration_guard (
  valid INTEGER NOT NULL CONSTRAINT legacy_auth_requires_review CHECK (valid = 1)
);
INSERT INTO auth_migration_guard (valid)
SELECT NOT EXISTS (
  SELECT 1 FROM users AS legacy
  LEFT JOIN "user" AS native ON native.id = legacy.id
  WHERE native.id IS NULL
    OR native.username IS NOT legacy.username_key
    OR native.email IS NOT lower(legacy.email)
    OR native.emailVerified IS NOT (legacy.email_verified_at IS NOT NULL)
    OR legacy.pending_email IS NOT NULL
    OR NOT EXISTS (
      SELECT 1 FROM account WHERE userId = legacy.id
        AND providerId = 'credential' AND accountId = legacy.id
        AND password = legacy.password_hash
    )
)
AND NOT EXISTS (SELECT 1 FROM email_verification_tokens)
AND NOT EXISTS (SELECT 1 FROM sessions)
AND NOT EXISTS (SELECT 1 FROM recovery_codes)
AND NOT EXISTS (SELECT 1 FROM reset_links)
AND NOT EXISTS (SELECT 1 FROM totp_credentials)
AND NOT EXISTS (SELECT 1 FROM passkeys)
AND NOT EXISTS (SELECT 1 FROM auth_challenges);

PRAGMA defer_foreign_keys = ON;

CREATE TABLE member_profiles (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES "user" (id),
  role TEXT NOT NULL CHECK (role IN ('member', 'admin')),
  status TEXT NOT NULL CHECK (status IN ('active', 'banned')),
  registration_state TEXT NOT NULL CHECK (registration_state IN ('pending', 'completed')),
  invited_by_user_id TEXT REFERENCES member_profiles (user_id),
  invite_quota INTEGER NOT NULL CHECK (invite_quota >= 0),
  created_at INTEGER NOT NULL,
  CHECK (invited_by_user_id IS NULL OR invited_by_user_id <> user_id)
);
CREATE INDEX member_profiles_invited_by_idx ON member_profiles (invited_by_user_id);
INSERT INTO member_profiles
  (user_id, role, status, registration_state, invited_by_user_id, invite_quota, created_at)
SELECT id, role, status, 'completed', invited_by_user_id, invite_quota, created_at FROM users;

CREATE TRIGGER member_profiles_identity_immutable
BEFORE UPDATE OF user_id, invited_by_user_id ON member_profiles
WHEN NEW.user_id IS NOT OLD.user_id OR NEW.invited_by_user_id IS NOT OLD.invited_by_user_id
BEGIN
  SELECT RAISE(ABORT, 'Member identity and invitation source are immutable');
END;
CREATE TRIGGER member_profiles_prevent_replacement
BEFORE INSERT ON member_profiles
WHEN EXISTS (SELECT 1 FROM member_profiles WHERE user_id = NEW.user_id)
BEGIN
  SELECT RAISE(ABORT, 'Member replacement is forbidden');
END;

-- Copy into a separate relation graph before dropping any old parent; CASCADE must not erase copies.
CREATE TABLE invitations_v2 (
  id TEXT PRIMARY KEY NOT NULL,
  code_hash TEXT NOT NULL UNIQUE,
  issuer_user_id TEXT REFERENCES member_profiles (user_id),
  used_by_user_id TEXT UNIQUE REFERENCES member_profiles (user_id),
  operation_id TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK (expires_at > created_at),
  revoked_at INTEGER,
  used_at INTEGER,
  CHECK ((used_by_user_id IS NULL) = (used_at IS NULL)),
  CHECK (issuer_user_id IS NULL OR issuer_user_id <> used_by_user_id),
  CHECK (issuer_user_id IS NULL OR operation_id IS NOT NULL)
);
INSERT INTO invitations_v2 SELECT * FROM invitations;

CREATE TABLE email_deliveries_v2 (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT REFERENCES member_profiles (user_id),
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
INSERT INTO email_deliveries_v2 SELECT * FROM email_deliveries;

CREATE TABLE watch_progress_v2 (
  user_id TEXT NOT NULL REFERENCES member_profiles (user_id),
  playable_unit_id TEXT NOT NULL REFERENCES playable_units (id),
  position_seconds REAL NOT NULL CHECK (position_seconds >= 0),
  completed INTEGER NOT NULL CHECK (completed IN (0, 1)),
  updated_at INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  PRIMARY KEY (user_id, playable_unit_id)
);
INSERT INTO watch_progress_v2 SELECT * FROM watch_progress;

CREATE TABLE favorites_v2 (
  user_id TEXT NOT NULL REFERENCES member_profiles (user_id),
  work_id TEXT NOT NULL REFERENCES works (id),
  PRIMARY KEY (user_id, work_id)
);
INSERT INTO favorites_v2 SELECT * FROM favorites;

CREATE TABLE playlists_v2 (
  id TEXT PRIMARY KEY NOT NULL,
  owner_user_id TEXT NOT NULL REFERENCES member_profiles (user_id),
  title TEXT NOT NULL,
  visibility TEXT NOT NULL CHECK (visibility IN ('private', 'members')),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
INSERT INTO playlists_v2 SELECT * FROM playlists;

CREATE TABLE playlist_items_v2 (
  id TEXT PRIMARY KEY NOT NULL,
  playlist_id TEXT NOT NULL REFERENCES playlists_v2 (id) ON DELETE CASCADE,
  work_id TEXT REFERENCES works (id),
  playable_unit_id TEXT REFERENCES playable_units (id),
  position INTEGER NOT NULL CHECK (position >= 0),
  CHECK ((work_id IS NOT NULL) <> (playable_unit_id IS NOT NULL)),
  UNIQUE (playlist_id, position)
);
INSERT INTO playlist_items_v2 SELECT * FROM playlist_items;

CREATE TABLE comments_v2 (
  id TEXT PRIMARY KEY NOT NULL,
  playable_unit_id TEXT NOT NULL REFERENCES playable_units (id),
  author_user_id TEXT NOT NULL REFERENCES member_profiles (user_id),
  body_markdown TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
INSERT INTO comments_v2 SELECT * FROM comments;

CREATE TABLE comment_replies_v2 (
  id TEXT PRIMARY KEY NOT NULL,
  comment_id TEXT NOT NULL REFERENCES comments_v2 (id) ON DELETE CASCADE,
  author_user_id TEXT NOT NULL REFERENCES member_profiles (user_id),
  reply_to_user_id TEXT REFERENCES member_profiles (user_id),
  body_markdown TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
INSERT INTO comment_replies_v2 SELECT * FROM comment_replies;

CREATE TABLE discussion_votes_v2 (
  user_id TEXT NOT NULL REFERENCES member_profiles (user_id),
  comment_id TEXT REFERENCES comments_v2 (id) ON DELETE CASCADE,
  reply_id TEXT REFERENCES comment_replies_v2 (id) ON DELETE CASCADE,
  value INTEGER NOT NULL CHECK (value IN (1, -1)),
  CHECK ((comment_id IS NOT NULL) <> (reply_id IS NOT NULL))
);
INSERT INTO discussion_votes_v2 SELECT * FROM discussion_votes;

DROP TABLE discussion_votes;
DROP TABLE comment_replies;
DROP TABLE comments;
DROP TABLE playlist_items;
DROP TABLE playlists;
DROP TABLE favorites;
DROP TABLE watch_progress;
DROP TABLE email_deliveries;
DROP TABLE invitations;

ALTER TABLE invitations_v2 RENAME TO invitations;
ALTER TABLE email_deliveries_v2 RENAME TO email_deliveries;
ALTER TABLE watch_progress_v2 RENAME TO watch_progress;
ALTER TABLE favorites_v2 RENAME TO favorites;
ALTER TABLE playlists_v2 RENAME TO playlists;
ALTER TABLE playlist_items_v2 RENAME TO playlist_items;
ALTER TABLE comments_v2 RENAME TO comments;
ALTER TABLE comment_replies_v2 RENAME TO comment_replies;
ALTER TABLE discussion_votes_v2 RENAME TO discussion_votes;

CREATE INDEX invitations_issuer_created_idx ON invitations (issuer_user_id, created_at);
CREATE UNIQUE INDEX invitations_issuer_operation_unique
  ON invitations (issuer_user_id, operation_id) WHERE issuer_user_id IS NOT NULL;
CREATE INDEX email_deliveries_quota_idx ON email_deliveries (to_email_key, purpose, created_at);
CREATE INDEX watch_progress_user_updated_idx ON watch_progress (user_id, updated_at);
CREATE INDEX playlists_owner_updated_idx ON playlists (owner_user_id, updated_at);
CREATE UNIQUE INDEX playlist_items_work_unique
  ON playlist_items (playlist_id, work_id) WHERE work_id IS NOT NULL;
CREATE UNIQUE INDEX playlist_items_unit_unique
  ON playlist_items (playlist_id, playable_unit_id) WHERE playable_unit_id IS NOT NULL;
CREATE INDEX comments_unit_created_idx ON comments (playable_unit_id, created_at, id);
CREATE INDEX comment_replies_comment_created_idx ON comment_replies (comment_id, created_at, id);
CREATE UNIQUE INDEX discussion_votes_user_comment_unique
  ON discussion_votes (user_id, comment_id) WHERE comment_id IS NOT NULL;
CREATE UNIQUE INDEX discussion_votes_user_reply_unique
  ON discussion_votes (user_id, reply_id) WHERE reply_id IS NOT NULL;
CREATE INDEX discussion_votes_comment_idx ON discussion_votes (comment_id) WHERE comment_id IS NOT NULL;
CREATE INDEX discussion_votes_reply_idx ON discussion_votes (reply_id) WHERE reply_id IS NOT NULL;

CREATE TABLE registration_attempts (
  id TEXT PRIMARY KEY NOT NULL,
  invitation_id TEXT NOT NULL REFERENCES invitations (id),
  user_id TEXT UNIQUE REFERENCES "user" (id),
  state TEXT NOT NULL CHECK (state IN ('reserved', 'created', 'completed', 'failed')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
  expires_at INTEGER NOT NULL CHECK (expires_at > created_at),
  CHECK (state NOT IN ('created', 'completed') OR user_id IS NOT NULL)
);
CREATE UNIQUE INDEX registration_attempts_active_invitation_unique
  ON registration_attempts (invitation_id) WHERE state IN ('reserved', 'created');
CREATE INDEX registration_attempts_expires_idx ON registration_attempts (state, expires_at);

-- Only empty legacy credential tables reach this point. Native credentials are never dropped.
DROP TABLE auth_challenges;
DROP TABLE sessions;
DROP TABLE recovery_codes;
DROP TABLE reset_links;
DROP TABLE totp_credentials;
DROP TABLE passkeys;
DROP TABLE email_verification_tokens;
DROP TABLE email_claims;
DROP TABLE users;
DROP TABLE auth_migration_guard;
PRAGMA defer_foreign_keys = OFF;
