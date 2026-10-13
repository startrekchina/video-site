-- Preserve existing data and refuse to install the invariant over inconsistent invitation records.
CREATE TABLE invitation_source_migration_guard (
  valid INTEGER NOT NULL CONSTRAINT invitation_source_requires_review CHECK (valid = 1)
);
INSERT INTO invitation_source_migration_guard (valid)
SELECT NOT EXISTS (
  SELECT 1 FROM invitations AS invitation
  JOIN member_profiles AS member ON member.user_id = invitation.used_by_user_id
  WHERE member.invited_by_user_id IS NOT invitation.issuer_user_id
);
DROP TABLE invitation_source_migration_guard;

-- NULL-safe comparison keeps bootstrap consumers at the root of the invitation chain.
CREATE TRIGGER invitations_match_inviter_insert
BEFORE INSERT ON invitations
WHEN NEW.used_by_user_id IS NOT NULL AND EXISTS (
  SELECT 1 FROM member_profiles
  WHERE user_id = NEW.used_by_user_id AND invited_by_user_id IS NOT NEW.issuer_user_id
)
BEGIN
  SELECT RAISE(ABORT, 'Invitation issuer does not match member inviter');
END;

CREATE TRIGGER invitations_match_inviter_update
BEFORE UPDATE OF issuer_user_id, used_by_user_id ON invitations
WHEN NEW.used_by_user_id IS NOT NULL AND EXISTS (
  SELECT 1 FROM member_profiles
  WHERE user_id = NEW.used_by_user_id AND invited_by_user_id IS NOT NEW.issuer_user_id
)
BEGIN
  SELECT RAISE(ABORT, 'Invitation issuer does not match member inviter');
END;

-- Deferred foreign keys can allow invitation consumption before profile creation.
CREATE TRIGGER member_profiles_match_consumed_invitation_insert
BEFORE INSERT ON member_profiles
WHEN EXISTS (
  SELECT 1 FROM invitations
  WHERE used_by_user_id = NEW.user_id AND issuer_user_id IS NOT NEW.invited_by_user_id
)
BEGIN
  SELECT RAISE(ABORT, 'Invitation issuer does not match member inviter');
END;
