-- Every video now names its quality tier, and each tier has one codec: 2160p/1080p VP9, 720p/480p H.264 (B 6.6).
-- Drop records outside that rule (the unsuffixed original and H.264 high tiers); media sync relinks compliant R2 objects.
-- R2 objects are left untouched; an old unsuffixed object is skipped as unknown. Unit durations stay until a tier relinks.
DELETE FROM media_files WHERE NOT ((variant IN ('2160p', '1080p') AND video_codec = 'vp9') OR (variant IN ('720p', '480p') AND video_codec = 'h264'));
