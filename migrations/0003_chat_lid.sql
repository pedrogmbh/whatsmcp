-- WhatsApp LID from GET /chats (`lid`: "27741764198600@lid").
-- Presence webhooks often send this id as `phone` instead of the MSISDN.
ALTER TABLE chats ADD COLUMN lid TEXT;
CREATE INDEX idx_chats_lid ON chats(lid);
