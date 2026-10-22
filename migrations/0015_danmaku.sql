-- Danmaku per playable unit (B 6.17). Deleting a row is final; send limits live in rate_limit_counters, so deletions refund nothing.
CREATE TABLE danmaku (
  id TEXT PRIMARY KEY NOT NULL,
  playable_unit_id TEXT NOT NULL REFERENCES playable_units (id),
  author_user_id TEXT NOT NULL REFERENCES member_profiles (user_id),
  position_seconds REAL NOT NULL CHECK (position_seconds >= 0),
  text TEXT NOT NULL CHECK (length(trim(text)) > 0),
  mode INTEGER NOT NULL CHECK (mode IN (0, 1, 2)),
  color TEXT NOT NULL CHECK (color IN ('#FFFFFF', '#F2C14E', '#E5534B', '#5BA4E6', '#6CC08B', '#B48EF0')),
  created_at INTEGER NOT NULL
);
CREATE INDEX danmaku_unit_created_idx ON danmaku (playable_unit_id, created_at, id);
