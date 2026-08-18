-- Inbox rows from Z-API webhooks. Dedup retries; edits are separate rows.
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  moment INTEGER NOT NULL DEFAULT 0,
  message_id TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  chat_name TEXT NOT NULL DEFAULT '',
  sender_name TEXT NOT NULL DEFAULT '',
  from_me INTEGER,
  is_group INTEGER,
  is_edit INTEGER NOT NULL DEFAULT 0,
  event_type TEXT NOT NULL DEFAULT '',
  message_kind TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL DEFAULT '',
  payload TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_events_dedup
  ON events(kind, message_id, event_type, moment, is_edit);

CREATE INDEX idx_events_phone_moment ON events(phone, moment DESC);
CREATE INDEX idx_events_kind_moment ON events(kind, moment DESC);
CREATE INDEX idx_events_message_id ON events(message_id);
CREATE INDEX idx_events_received_at ON events(received_at DESC);

CREATE VIRTUAL TABLE events_fts USING fts5(
  text,
  chat_name,
  sender_name,
  phone,
  content='events',
  content_rowid='id',
  tokenize='unicode61'
);

CREATE TRIGGER events_ai AFTER INSERT ON events BEGIN
  INSERT INTO events_fts(rowid, text, chat_name, sender_name, phone)
  VALUES (new.id, new.text, new.chat_name, new.sender_name, new.phone);
END;

CREATE TRIGGER events_ad AFTER DELETE ON events BEGIN
  INSERT INTO events_fts(events_fts, rowid, text, chat_name, sender_name, phone)
  VALUES ('delete', old.id, old.text, old.chat_name, old.sender_name, old.phone);
END;

CREATE TRIGGER events_au AFTER UPDATE ON events BEGIN
  INSERT INTO events_fts(events_fts, rowid, text, chat_name, sender_name, phone)
  VALUES ('delete', old.id, old.text, old.chat_name, old.sender_name, old.phone);
  INSERT INTO events_fts(rowid, text, chat_name, sender_name, phone)
  VALUES (new.id, new.text, new.chat_name, new.sender_name, new.phone);
END;
