-- 0009 replaces invitations before dropping users; this cross-table trigger would block its renames.
-- Invitation-side guards retire with the old table; 0009_member_profiles_invitation_guard protects the member_profiles relation graph.
DROP TRIGGER IF EXISTS users_match_consumed_invitation_insert;
