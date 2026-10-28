-- Stop on existing duplicates: choosing a credential automatically could lock out its owner.
CREATE UNIQUE INDEX two_factor_user_unique ON twoFactor (userId);
DROP INDEX twoFactor_userId_idx;
