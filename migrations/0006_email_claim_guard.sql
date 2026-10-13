-- All timestamps are UTC Unix milliseconds (INTEGER).
-- Reject direct claim deletion before a deferred foreign key reaches transaction completion.
CREATE TRIGGER email_claims_protect_delete
BEFORE DELETE ON email_claims
WHEN EXISTS (
  SELECT 1 FROM users WHERE id = OLD.user_id AND (
    (OLD.kind = 'current' AND email_key = OLD.email_key)
    OR (OLD.kind = 'pending' AND pending_email_key = OLD.email_key)
  )
)
BEGIN
  SELECT RAISE(ABORT, 'Email claim is still in use');
END;

DROP TRIGGER users_claim_emails_update;
CREATE TRIGGER users_claim_emails_update
AFTER UPDATE OF email_key, pending_email_key ON users
BEGIN
  DELETE FROM email_claims WHERE user_id = NEW.id AND (
    (kind = 'current' AND email_key IS NOT NEW.email_key)
    OR (kind = 'pending' AND email_key IS NOT NEW.pending_email_key)
  );
  INSERT INTO email_claims (email_key, user_id, kind)
    SELECT NEW.email_key, NEW.id, 'current'
    WHERE NOT EXISTS (
      SELECT 1 FROM email_claims WHERE user_id = NEW.id AND kind = 'current'
    );
  INSERT INTO email_claims (email_key, user_id, kind)
    SELECT NEW.pending_email_key, NEW.id, 'pending'
    WHERE NEW.pending_email_key IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM email_claims WHERE user_id = NEW.id AND kind = 'pending'
    );
END;
