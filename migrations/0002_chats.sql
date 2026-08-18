-- Chat snapshots from GET /chats and GET /chats/{phone}.
-- Optional `tags` is an array of string ids (WhatsApp/Z-API filter indexes).
CREATE TABLE chats (
  phone TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  unread INTEGER,
  pinned INTEGER,
  archived INTEGER,
  muted INTEGER,
  is_spam INTEGER,
  is_group INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE TABLE chat_tags (
  phone TEXT NOT NULL,
  tag TEXT NOT NULL,
  PRIMARY KEY (phone, tag)
);

CREATE INDEX idx_chat_tags_tag ON chat_tags(tag);
