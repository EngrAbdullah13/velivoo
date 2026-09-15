import { createHash } from "node:crypto";
import type { EmailVersion, Profile, SenderIdentity, Workspace } from "../../domain/src/entities.js";
import { signUnsubscribeToken } from "./unsubscribe-token.js";

function esc(value: string): string { return value.replace(/[&<>\"']/g, (ch) => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[ch]!)); }

export function renderProofEmail(input: {
  workspace: Workspace; profile: Profile; version: EmailVersion; sender: SenderIdentity; publicBaseUrl: string; unsubscribeSecret: string;
}) {
  const firstName = input.profile.firstName?.trim() || "there";
  const token = signUnsubscribeToken({ workspaceId: input.workspace.id, profileId: input.profile.id, purpose: "marketing", v: 1 }, input.unsubscribeSecret);
  const unsubscribeUrl = `${input.publicBaseUrl.replace(/\/$/, "")}/public/v1/unsubscribe?token=${encodeURIComponent(token)}`;
  const replace = (s: string) => s.replaceAll("{{ profile.first_name }}", esc(firstName)).replaceAll("{{ system.unsubscribe_url }}", unsubscribeUrl)
    .replaceAll("{{ workspace.business_name }}", esc(input.workspace.legalName));
  const subject = replace(input.version.subjectTemplate).replace(/[\r\n]/g, " ");
  const footerHtml = `<hr><p style="font-size:12px">${esc(input.workspace.legalName)} · ${esc(input.workspace.businessAddress)} · <a href="${unsubscribeUrl}">Unsubscribe</a></p>`;
  const html = replace(input.version.htmlTemplate) + footerHtml;
  const text = replace(input.version.textTemplate) + `\n\n${input.workspace.legalName} · ${input.workspace.businessAddress}\nUnsubscribe: ${unsubscribeUrl}`;
  return { subject, html, text, unsubscribeUrl, hash: createHash("sha256").update(subject+"\n"+html+"\n"+text).digest("hex") };
}
