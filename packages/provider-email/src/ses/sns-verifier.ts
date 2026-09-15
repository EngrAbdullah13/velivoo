import { createPublicKey, verify as cryptoVerify } from "node:crypto";

export interface SnsEnvelope {
  Type: "Notification" | "SubscriptionConfirmation" | "UnsubscribeConfirmation";
  MessageId: string;
  TopicArn: string;
  Message: string;
  Timestamp: string;
  SignatureVersion: "1" | "2";
  Signature: string;
  SigningCertURL: string;
  Subject?: string;
  Token?: string;
  SubscribeURL?: string;
}

export function assertSafeAwsSnsUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("SNS_URL_NOT_HTTPS");
  const host = url.hostname.toLowerCase();
  if (!(host === "sns.amazonaws.com" || /^sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/.test(host))) throw new Error("SNS_URL_HOST_REJECTED");
  if (url.pathname && !url.pathname.startsWith("/SimpleNotificationService-") && !url.searchParams.has("Action")) throw new Error("SNS_URL_PATH_REJECTED");
  return url;
}


export function assertExpectedSnsTopic(envelope: SnsEnvelope, expectedTopicArn?: string): void {
  if (!expectedTopicArn) return;
  if (envelope.TopicArn !== expectedTopicArn) throw new Error("SNS_TOPIC_ARN_REJECTED");
}

export function snsStringToSign(m: SnsEnvelope): string {
  const parts: string[] = [];
  const push = (k: string, v: string | undefined) => { if (v !== undefined) { parts.push(k, v); } };
  if (m.Type === "Notification") {
    push("Message", m.Message); push("MessageId", m.MessageId); push("Subject", m.Subject); push("Timestamp", m.Timestamp); push("TopicArn", m.TopicArn); push("Type", m.Type);
  } else {
    push("Message", m.Message); push("MessageId", m.MessageId); push("SubscribeURL", m.SubscribeURL); push("Timestamp", m.Timestamp); push("Token", m.Token); push("TopicArn", m.TopicArn); push("Type", m.Type);
  }
  return parts.map((x) => `${x}\n`).join("");
}

export function verifySnsEnvelopeWithPem(envelope: SnsEnvelope, pem: string): boolean {
  assertSafeAwsSnsUrl(envelope.SigningCertURL);
  const algorithm = envelope.SignatureVersion === "2" ? "RSA-SHA256" : "RSA-SHA1";
  const signature = Buffer.from(envelope.Signature, "base64");
  return cryptoVerify(algorithm, Buffer.from(snsStringToSign(envelope)), createPublicKey(pem), signature);
}

export async function fetchAndVerifySnsEnvelope(envelope: SnsEnvelope, expectedTopicArn?: string): Promise<boolean> {
  assertExpectedSnsTopic(envelope, expectedTopicArn);
  const certUrl = assertSafeAwsSnsUrl(envelope.SigningCertURL);
  const response = await fetch(certUrl, { redirect: "error" });
  if (!response.ok) throw new Error("SNS_CERT_FETCH_FAILED");
  const pem = await response.text();
  if (pem.length > 64_000) throw new Error("SNS_CERT_TOO_LARGE");
  return verifySnsEnvelopeWithPem(envelope, pem);
}

export async function safelyConfirmSubscription(envelope: SnsEnvelope): Promise<void> {
  if (envelope.Type !== "SubscriptionConfirmation" || !envelope.SubscribeURL) throw new Error("NOT_SUBSCRIPTION_CONFIRMATION");
  const url = assertSafeAwsSnsUrl(envelope.SubscribeURL);
  const response = await fetch(url, { redirect: "error" });
  if (!response.ok) throw new Error("SNS_CONFIRM_FAILED");
}
