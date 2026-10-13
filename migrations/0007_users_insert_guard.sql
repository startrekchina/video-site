-- REPLACE deletes the conflicting row without running UPDATE triggers.
-- Members must be changed with UPDATE so invitation and email guards always run.
CREATE TRIGGER users_prevent_replacement
BEFORE INSERT ON users
WHEN EXISTS (SELECT 1 FROM users WHERE id = NEW.id OR username_key = NEW.username_key)
BEGIN
  SELECT RAISE(ABORT, 'User replacement is forbidden');
END;
