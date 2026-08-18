-- Retention-ready timestamps (unix ms). Purge can DELETE WHERE created_at < cutoff.
ALTER TABLE events ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE events ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
UPDATE events SET created_at = received_at, updated_at = received_at WHERE created_at = 0;

ALTER TABLE chats ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0;
UPDATE chats SET created_at = updated_at WHERE created_at = 0;

ALTER TABLE chat_tags ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE chat_tags ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
UPDATE chat_tags SET
  created_at = COALESCE((SELECT updated_at FROM chats WHERE chats.phone = chat_tags.phone), created_at),
  updated_at = COALESCE((SELECT updated_at FROM chats WHERE chats.phone = chat_tags.phone), updated_at);

CREATE INDEX idx_events_created_at ON events(created_at);
CREATE INDEX idx_chats_created_at ON chats(created_at);
CREATE INDEX idx_chats_updated_at ON chats(updated_at);
CREATE INDEX idx_chat_tags_created_at ON chat_tags(created_at);
CREATE INDEX idx_chat_tags_updated_at ON chat_tags(updated_at);
