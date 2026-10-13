-- All timestamps are UTC Unix milliseconds (INTEGER).
-- Discussion deletion removes records directly, with no soft-delete or archive fields.
CREATE TABLE comments (
  id TEXT PRIMARY KEY NOT NULL,
  playable_unit_id TEXT NOT NULL REFERENCES playable_units (id),
  author_user_id TEXT NOT NULL REFERENCES users (id),
  body_markdown TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX comments_unit_created_idx ON comments (playable_unit_id, created_at, id);

CREATE TABLE comment_replies (
  id TEXT PRIMARY KEY NOT NULL,
  comment_id TEXT NOT NULL REFERENCES comments (id) ON DELETE CASCADE,
  author_user_id TEXT NOT NULL REFERENCES users (id),
  reply_to_user_id TEXT REFERENCES users (id),
  body_markdown TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX comment_replies_comment_created_idx ON comment_replies (comment_id, created_at, id);

CREATE TABLE discussion_votes (
  user_id TEXT NOT NULL REFERENCES users (id),
  comment_id TEXT REFERENCES comments (id) ON DELETE CASCADE,
  reply_id TEXT REFERENCES comment_replies (id) ON DELETE CASCADE,
  value INTEGER NOT NULL CHECK (value IN (1, -1)),
  CHECK ((comment_id IS NOT NULL) <> (reply_id IS NOT NULL))
);
CREATE UNIQUE INDEX discussion_votes_user_comment_unique
  ON discussion_votes (user_id, comment_id) WHERE comment_id IS NOT NULL;
CREATE UNIQUE INDEX discussion_votes_user_reply_unique
  ON discussion_votes (user_id, reply_id) WHERE reply_id IS NOT NULL;
CREATE INDEX discussion_votes_comment_idx ON discussion_votes (comment_id) WHERE comment_id IS NOT NULL;
CREATE INDEX discussion_votes_reply_idx ON discussion_votes (reply_id) WHERE reply_id IS NOT NULL;
