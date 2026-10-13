-- All timestamps are UTC Unix milliseconds (INTEGER).
CREATE TABLE watch_progress (
  user_id TEXT NOT NULL REFERENCES users (id),
  playable_unit_id TEXT NOT NULL REFERENCES playable_units (id),
  position_seconds REAL NOT NULL CHECK (position_seconds >= 0),
  completed INTEGER NOT NULL CHECK (completed IN (0, 1)),
  updated_at INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  PRIMARY KEY (user_id, playable_unit_id)
);
CREATE INDEX watch_progress_user_updated_idx ON watch_progress (user_id, updated_at);

CREATE TABLE favorites (
  user_id TEXT NOT NULL REFERENCES users (id),
  work_id TEXT NOT NULL REFERENCES works (id),
  PRIMARY KEY (user_id, work_id)
);

CREATE TABLE playlists (
  id TEXT PRIMARY KEY NOT NULL,
  owner_user_id TEXT NOT NULL REFERENCES users (id),
  title TEXT NOT NULL,
  visibility TEXT NOT NULL CHECK (visibility IN ('private', 'members')),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX playlists_owner_updated_idx ON playlists (owner_user_id, updated_at);

CREATE TABLE playlist_items (
  id TEXT PRIMARY KEY NOT NULL,
  playlist_id TEXT NOT NULL REFERENCES playlists (id) ON DELETE CASCADE,
  work_id TEXT REFERENCES works (id),
  playable_unit_id TEXT REFERENCES playable_units (id),
  position INTEGER NOT NULL CHECK (position >= 0),
  CHECK ((work_id IS NOT NULL) <> (playable_unit_id IS NOT NULL)),
  UNIQUE (playlist_id, position)
);
CREATE UNIQUE INDEX playlist_items_work_unique
  ON playlist_items (playlist_id, work_id) WHERE work_id IS NOT NULL;
CREATE UNIQUE INDEX playlist_items_unit_unique
  ON playlist_items (playlist_id, playable_unit_id) WHERE playable_unit_id IS NOT NULL;
