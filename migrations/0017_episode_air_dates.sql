-- TMDB episode air date as YYYY-MM-DD text (a calendar date, not a UTC timestamp); NULL for movies and undated episodes.
ALTER TABLE playable_units ADD COLUMN air_date TEXT;
