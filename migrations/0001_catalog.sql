-- All timestamps in these migrations are UTC Unix milliseconds (INTEGER).
-- Durations and playback positions are measured in seconds.
CREATE TABLE works (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('movie', 'series')),
  tmdb_id INTEGER NOT NULL CHECK (tmdb_id > 0),
  title_zh TEXT,
  title_en TEXT,
  overview_zh TEXT,
  overview_en TEXT,
  year INTEGER,
  poster_asset TEXT,
  UNIQUE (kind, tmdb_id),
  UNIQUE (id, kind)
);

CREATE TABLE seasons (
  id TEXT PRIMARY KEY NOT NULL,
  work_id TEXT NOT NULL,
  work_kind TEXT NOT NULL DEFAULT 'series' CHECK (work_kind = 'series'),
  season_number INTEGER NOT NULL CHECK (season_number >= 0),
  tmdb_id INTEGER NOT NULL CHECK (tmdb_id > 0),
  title_zh TEXT,
  title_en TEXT,
  overview_zh TEXT,
  overview_en TEXT,
  poster_asset TEXT,
  FOREIGN KEY (work_id, work_kind) REFERENCES works (id, kind),
  UNIQUE (work_id, season_number),
  UNIQUE (id, work_id)
);

CREATE TABLE playable_units (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('movie', 'episode')),
  work_id TEXT NOT NULL,
  work_kind TEXT GENERATED ALWAYS AS (
    CASE kind WHEN 'movie' THEN 'movie' ELSE 'series' END
  ) STORED,
  season_id TEXT,
  episode_number INTEGER,
  tmdb_id INTEGER NOT NULL CHECK (tmdb_id > 0),
  duration_seconds REAL NOT NULL CHECK (duration_seconds > 0),
  title_zh TEXT,
  title_en TEXT,
  overview_zh TEXT,
  overview_en TEXT,
  FOREIGN KEY (work_id, work_kind) REFERENCES works (id, kind),
  FOREIGN KEY (season_id, work_id) REFERENCES seasons (id, work_id),
  CHECK (
    (kind = 'movie' AND season_id IS NULL AND episode_number IS NULL)
    OR (kind = 'episode' AND season_id IS NOT NULL
      AND episode_number IS NOT NULL AND episode_number > 0)
  )
);

CREATE UNIQUE INDEX playable_units_movie_work_unique
  ON playable_units (work_id) WHERE kind = 'movie';
CREATE UNIQUE INDEX playable_units_season_episode_unique
  ON playable_units (season_id, episode_number) WHERE kind = 'episode';
CREATE INDEX playable_units_work_idx ON playable_units (work_id);

-- Formats and variants remain open to additional media encodings and subtitle formats.
CREATE TABLE media_files (
  id TEXT PRIMARY KEY NOT NULL,
  playable_unit_id TEXT NOT NULL REFERENCES playable_units (id),
  format TEXT NOT NULL CHECK (length(format) > 0),
  variant TEXT NOT NULL CHECK (length(variant) > 0),
  object_key TEXT NOT NULL UNIQUE,
  byte_length INTEGER NOT NULL CHECK (byte_length > 0),
  checksum_sha256 TEXT NOT NULL,
  duration_seconds REAL NOT NULL CHECK (duration_seconds > 0),
  video_codec TEXT NOT NULL,
  audio_codec TEXT NOT NULL,
  bitrate INTEGER NOT NULL CHECK (bitrate > 0),
  UNIQUE (playable_unit_id, format, variant)
);

CREATE TABLE subtitle_tracks (
  id TEXT PRIMARY KEY NOT NULL,
  playable_unit_id TEXT NOT NULL REFERENCES playable_units (id),
  language TEXT NOT NULL,
  format TEXT NOT NULL CHECK (length(format) > 0),
  display_name TEXT NOT NULL,
  track_key TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  byte_length INTEGER NOT NULL CHECK (byte_length > 0),
  checksum_sha256 TEXT NOT NULL,
  UNIQUE (playable_unit_id, track_key)
);
