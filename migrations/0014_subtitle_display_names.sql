-- Relabel synced subtitle tracks that still show the storage track key; names set by the import tool are left alone.
-- Mirrors subtitleLabel() in app/lib/media-sync.server.ts. Plain UPDATEs, no CASE: D1's remote splitter mis-reads bare CASE ... END.
UPDATE subtitle_tracks SET display_name = '繁体中文' WHERE display_name = '中文 · ' || track_key AND track_key = language || '.main'
  AND (language LIKE 'zh-TW%' OR language LIKE 'zh-HK%' OR language LIKE 'zh-MO%' OR language LIKE 'zh-Hant%');
UPDATE subtitle_tracks SET display_name = '繁体中文（' || substr(track_key, length(language) + 2) || '）' WHERE display_name = '中文 · ' || track_key
  AND (language LIKE 'zh-TW%' OR language LIKE 'zh-HK%' OR language LIKE 'zh-MO%' OR language LIKE 'zh-Hant%');
UPDATE subtitle_tracks SET display_name = '中文' WHERE display_name = '中文 · ' || track_key AND track_key = language || '.main';
UPDATE subtitle_tracks SET display_name = '中文（' || substr(track_key, length(language) + 2) || '）' WHERE display_name = '中文 · ' || track_key;
UPDATE subtitle_tracks SET display_name = '英文' WHERE display_name = 'English · ' || track_key AND track_key = language || '.main';
UPDATE subtitle_tracks SET display_name = '英文（' || substr(track_key, length(language) + 2) || '）' WHERE display_name = 'English · ' || track_key;
