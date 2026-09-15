ALTER TABLE "inbox_message" ADD COLUMN IF NOT EXISTS "payload_json" JSONB;
