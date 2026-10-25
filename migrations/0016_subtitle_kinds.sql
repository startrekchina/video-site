-- SUB1 keeps only zh-CN/zh-TW main/bilingual tracks with labels from subtitleTrack(); clear every row so media sync relinks
-- the compliant R2 objects with the new labels. R2 objects are left untouched; non-compliant ones are skipped as unknown.
DELETE FROM subtitle_tracks;
