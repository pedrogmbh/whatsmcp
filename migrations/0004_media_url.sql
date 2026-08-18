-- Z-API media link from received/fromMe webhooks (expires in ~30 days).
ALTER TABLE events ADD COLUMN media_url TEXT NOT NULL DEFAULT '';
