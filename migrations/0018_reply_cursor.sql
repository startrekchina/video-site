-- Keep a conversation's cursor monotonic even when its latest reply is deleted.
CREATE TABLE comment_reply_cursors (
  comment_id TEXT PRIMARY KEY NOT NULL REFERENCES comments (id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);
INSERT INTO comment_reply_cursors (comment_id, created_at)
  SELECT comment_id, max(created_at) FROM comment_replies GROUP BY comment_id;

CREATE TRIGGER comment_reply_cursor_insert AFTER INSERT ON comment_replies
BEGIN
  INSERT INTO comment_reply_cursors (comment_id, created_at) VALUES (NEW.comment_id, NEW.created_at)
    ON CONFLICT (comment_id) DO UPDATE SET created_at = max(created_at, excluded.created_at);
END;
