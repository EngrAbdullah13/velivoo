import test from "node:test";
import assert from "node:assert/strict";
import { normalizeSesSnsEnvelope } from "../packages/provider-email/src/ses/normalize-feedback.js";

test("SES SNS Open notifications preserve SES message correlation and occurrence time", () => {
  const events = normalizeSesSnsEnvelope({
    Type: "Notification",
    MessageId: "sns-open-event-1",
    Timestamp: "2026-09-22T10:01:00.000Z",
    TopicArn: "arn:aws:sns:us-east-1:123456789012:velivoo-feedback",
    SignatureVersion: "2",
    Signature: "test-signature",
    SigningCertURL: "https://sns.us-east-1.amazonaws.com/SimpleNotificationService-test.pem",
    Message: JSON.stringify({
      eventType: "Open",
      mail: {
        messageId: "ses-message-1",
        timestamp: "2026-09-22T10:00:00.000Z",
        tags: { platformMessageId: ["11111111-1111-4111-8111-111111111111"] },
      },
      open: {
        timestamp: "2026-09-22T10:00:30.000Z",
        isBotEvent: "Unlikely",
      },
    }),
  });

  assert.deepEqual(events, [{
    providerEventId: "sns-open-event-1",
    provider: "ses",
    providerMessageId: "ses-message-1",
    eventType: "open",
    occurredAt: "2026-09-22T10:00:30.000Z",
    rawType: "open",
    metadata: {
      platformMessageId: "11111111-1111-4111-8111-111111111111",
      requestFingerprint: undefined,
      bounceType: undefined,
      bounceSubType: undefined,
      complaintFeedbackType: undefined,
      openIsBotEvent: "Unlikely",
    },
  }]);
});
