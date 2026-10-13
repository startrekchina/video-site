-- Persist the intended identity before Better Auth can leave a partially created user behind.
ALTER TABLE registration_attempts ADD COLUMN expected_user_id TEXT;
ALTER TABLE registration_attempts ADD COLUMN identity_key TEXT;
CREATE UNIQUE INDEX registration_attempts_expected_user_unique ON registration_attempts (expected_user_id);
CREATE UNIQUE INDEX account_credential_user_unique ON account (userId) WHERE providerId = 'credential';

CREATE TRIGGER registration_attempt_owner_immutable
BEFORE UPDATE OF id, invitation_id, expected_user_id, identity_key ON registration_attempts
WHEN NEW.id IS NOT OLD.id OR NEW.invitation_id IS NOT OLD.invitation_id
  OR NEW.expected_user_id IS NOT OLD.expected_user_id OR NEW.identity_key IS NOT OLD.identity_key
BEGIN
  SELECT RAISE(ABORT, 'Registration ownership is immutable');
END;

CREATE TRIGGER registration_attempt_prevent_replacement
BEFORE INSERT ON registration_attempts
WHEN EXISTS (SELECT 1 FROM registration_attempts WHERE id = NEW.id)
BEGIN
  SELECT RAISE(ABORT, 'Registration replacement is forbidden');
END;

CREATE TRIGGER registration_attempt_user_guard
BEFORE UPDATE OF user_id ON registration_attempts
WHEN NEW.expected_user_id IS NOT NULL AND NEW.user_id IS NOT NULL
  AND NEW.user_id IS NOT NEW.expected_user_id
BEGIN
  SELECT RAISE(ABORT, 'Registration user does not match its owner');
END;

-- A single profile insertion consumes the invitation and completes the attempt atomically.
CREATE TRIGGER registration_member_commit
AFTER INSERT ON member_profiles
WHEN EXISTS (SELECT 1 FROM registration_attempts WHERE user_id = NEW.user_id AND state = 'created')
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM registration_attempts AS a
    JOIN invitations AS i ON i.id = a.invitation_id
    JOIN "user" AS u ON u.id = a.user_id
    WHERE a.user_id = NEW.user_id AND a.expected_user_id = NEW.user_id AND a.state = 'created'
      AND a.expires_at > NEW.created_at
      AND i.used_by_user_id IS NULL AND i.revoked_at IS NULL AND i.expires_at > NEW.created_at
      AND i.created_at <= NEW.created_at
      AND NEW.invited_by_user_id IS i.issuer_user_id
      AND NEW.role = 'member' AND NEW.status = 'active' AND NEW.registration_state = 'completed'
      AND EXISTS (SELECT 1 FROM account WHERE userId = u.id AND providerId = 'credential'
        AND accountId = u.id AND password IS NOT NULL)
      AND (i.issuer_user_id IS NULL OR EXISTS (
        SELECT 1 FROM member_profiles AS issuer JOIN "user" AS issuer_auth ON issuer_auth.id = issuer.user_id
        WHERE issuer.user_id = i.issuer_user_id AND issuer.status = 'active'
          AND issuer.registration_state = 'completed' AND issuer_auth.emailVerified = 1
      ))
  ) THEN RAISE(ABORT, 'Registration completion conditions failed') END;

  UPDATE invitations SET used_by_user_id = NEW.user_id, used_at = NEW.created_at
  WHERE id = (SELECT invitation_id FROM registration_attempts WHERE user_id = NEW.user_id);
  UPDATE registration_attempts SET state = 'completed', updated_at = NEW.created_at WHERE user_id = NEW.user_id;
END;
