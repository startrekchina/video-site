DROP TRIGGER member_ban_revoke_access;

CREATE TRIGGER member_ban_revoke_access
AFTER UPDATE OF status ON member_profiles
WHEN NEW.status = 'banned' AND OLD.status <> 'banned'
BEGIN
  UPDATE invitations SET revoked_at = CAST(unixepoch('subsec') * 1000 AS INTEGER)
    WHERE issuer_user_id = NEW.user_id AND used_by_user_id IS NULL AND revoked_at IS NULL
      AND expires_at > CAST(unixepoch('subsec') * 1000 AS INTEGER);
  DELETE FROM session WHERE userId = NEW.user_id;
END;
