ALTER TABLE "sender_domain"
ADD COLUMN "sending_purpose" TEXT;

ALTER TABLE "sender_domain"
ADD CONSTRAINT "sender_domain_sending_purpose_check"
CHECK ("sending_purpose" IS NULL OR "sending_purpose" IN ('marketing', 'transactional'));
