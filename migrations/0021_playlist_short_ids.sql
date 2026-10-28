-- Playlist page paths use 8-character base62 ids (B 6.11). Items move to the copied playlist before the old one is deleted,
-- so ON DELETE CASCADE removes nothing. random() runs per row; a duplicate fails the whole migration, which can simply run again.
CREATE TABLE playlist_id_map (old_id TEXT PRIMARY KEY NOT NULL, new_id TEXT NOT NULL UNIQUE);
INSERT INTO playlist_id_map (old_id, new_id)
  SELECT p.id, substr(c.a, 1 + abs(random() % 62), 1) || substr(c.a, 1 + abs(random() % 62), 1) || substr(c.a, 1 + abs(random() % 62), 1) || substr(c.a, 1 + abs(random() % 62), 1)
    || substr(c.a, 1 + abs(random() % 62), 1) || substr(c.a, 1 + abs(random() % 62), 1) || substr(c.a, 1 + abs(random() % 62), 1) || substr(c.a, 1 + abs(random() % 62), 1)
  FROM playlists p, (SELECT '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz' AS a) c;
INSERT INTO playlists (id, owner_user_id, title, visibility, revision, created_at, updated_at)
  SELECT m.new_id, p.owner_user_id, p.title, p.visibility, p.revision, p.created_at, p.updated_at FROM playlists p JOIN playlist_id_map m ON m.old_id = p.id;
UPDATE playlist_items SET playlist_id = (SELECT new_id FROM playlist_id_map WHERE old_id = playlist_items.playlist_id);
DELETE FROM playlists WHERE id IN (SELECT old_id FROM playlist_id_map);
DROP TABLE playlist_id_map;
