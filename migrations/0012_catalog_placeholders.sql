-- Preserve stable unit IDs and all dependent records while allowing unknown catalog duration.
PRAGMA defer_foreign_keys = ON;
CREATE TABLE playable_units_next (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('movie', 'episode')),
  work_id TEXT NOT NULL,
  work_kind TEXT GENERATED ALWAYS AS (CASE kind WHEN 'movie' THEN 'movie' ELSE 'series' END) STORED,
  season_id TEXT,
  episode_number INTEGER,
  tmdb_id INTEGER NOT NULL CHECK (tmdb_id > 0),
  duration_seconds REAL CHECK (duration_seconds IS NULL OR duration_seconds > 0),
  title_zh TEXT, title_en TEXT, overview_zh TEXT, overview_en TEXT,
  FOREIGN KEY (work_id, work_kind) REFERENCES works (id, kind),
  FOREIGN KEY (season_id, work_id) REFERENCES seasons (id, work_id),
  CHECK ((kind = 'movie' AND season_id IS NULL AND episode_number IS NULL)
    OR (kind = 'episode' AND season_id IS NOT NULL AND episode_number IS NOT NULL AND episode_number > 0))
);
INSERT INTO playable_units_next (id, kind, work_id, season_id, episode_number, tmdb_id, duration_seconds, title_zh, title_en, overview_zh, overview_en)
  SELECT id, kind, work_id, season_id, episode_number, tmdb_id, duration_seconds, title_zh, title_en, overview_zh, overview_en FROM playable_units;
DROP TABLE playable_units;
ALTER TABLE playable_units_next RENAME TO playable_units;
CREATE UNIQUE INDEX playable_units_movie_work_unique ON playable_units (work_id) WHERE kind = 'movie';
CREATE UNIQUE INDEX playable_units_season_episode_unique ON playable_units (season_id, episode_number) WHERE kind = 'episode';
CREATE INDEX playable_units_work_idx ON playable_units (work_id);
ALTER TABLE media_files ADD COLUMN r2_etag TEXT;
ALTER TABLE subtitle_tracks ADD COLUMN r2_etag TEXT;
CREATE TABLE media_sync_state (
  id TEXT PRIMARY KEY NOT NULL CHECK (id = 'catalog'),
  cursor TEXT,
  lease_id TEXT NOT NULL,
  lease_until INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
PRAGMA defer_foreign_keys = OFF;
