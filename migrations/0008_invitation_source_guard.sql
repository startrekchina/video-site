-- A consumed invitation must agree with the member's immutable invitation source.
-- IS NOT compares NULL safely so bootstrap invitations only match members without an inviter.
CREATE TRIGGER invitations_match_inviter_insert
BEFORE INSERT ON invitations
WHEN NEW.used_by_user_id IS NOT NULL AND EXISTS (
  SELECT 1 FROM users
  WHERE id = NEW.used_by_user_id AND invited_by_user_id IS NOT NEW.issuer_user_id
)
BEGIN
  SELECT RAISE(ABORT, 'Invitation issuer does not match member inviter');
END;

CREATE TRIGGER invitations_match_inviter_update
BEFORE UPDATE OF issuer_user_id, used_by_user_id ON invitations
WHEN NEW.used_by_user_id IS NOT NULL AND EXISTS (
  SELECT 1 FROM users
  WHERE id = NEW.used_by_user_id AND invited_by_user_id IS NOT NEW.issuer_user_id
)
BEGIN
  SELECT RAISE(ABORT, 'Invitation issuer does not match member inviter');
END;

-- Deferred foreign keys can allow invitation consumption before member creation.
CREATE TRIGGER users_match_consumed_invitation_insert
BEFORE INSERT ON users
WHEN EXISTS (
  SELECT 1 FROM invitations
  WHERE used_by_user_id = NEW.id AND issuer_user_id IS NOT NEW.invited_by_user_id
)
BEGIN
  SELECT RAISE(ABORT, 'Invitation issuer does not match member inviter');
END;
