import { randomUUID } from "node:crypto";

function headerSafe(value: string): string { if (/[\r\n]/.test(value)) throw new Error("HEADER_INJECTION"); return value; }

export function buildMime(input: {
  fromName: string; fromEmail: string; replyTo: string; to: string; subject: string; html: string; text: string; unsubscribeUrl: string;
}): string {
  const boundary = `=_phase0_${randomUUID()}`;
  const messageId = `<${randomUUID()}@${input.fromEmail.split("@")[1] ?? "localhost"}>`;
  const headers = [
    `From: ${headerSafe(input.fromName)} <${headerSafe(input.fromEmail)}>` ,
    `To: ${headerSafe(input.to)}`,
    `Reply-To: ${headerSafe(input.replyTo)}`,
    `Subject: ${headerSafe(input.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: ${messageId}`,
    `MIME-Version: 1.0`,
    `List-Unsubscribe: <${headerSafe(input.unsubscribeUrl)}>` ,
    `List-Unsubscribe-Post: List-Unsubscribe=One-Click`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];
  return [
    ...headers, "", `--${boundary}`, `Content-Type: text/plain; charset=utf-8`, `Content-Transfer-Encoding: 8bit`, "", input.text,
    `--${boundary}`, `Content-Type: text/html; charset=utf-8`, `Content-Transfer-Encoding: 8bit`, "", input.html,
    `--${boundary}--`, ""
  ].join("\r\n");
}
