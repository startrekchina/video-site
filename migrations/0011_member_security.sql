-- Native password updates revoke old sessions before a replacement session can be created.
CREATE TRIGGER account_password_revoke_sessions
AFTER UPDATE OF password ON account
WHEN NEW.providerId = 'credential' AND NEW.password IS NOT OLD.password
BEGIN
  DELETE FROM session WHERE userId = NEW.userId;
END;

CREATE TRIGGER member_ban_revoke_access
AFTER UPDATE OF status ON member_profiles
WHEN NEW.status = 'banned' AND OLD.status <> 'banned'
BEGIN
  UPDATE invitations SET revoked_at = CAST(unixepoch('subsec') * 1000 AS INTEGER)
    WHERE issuer_user_id = NEW.user_id AND used_by_user_id IS NULL AND revoked_at IS NULL;
  DELETE FROM session WHERE userId = NEW.user_id;
END;
