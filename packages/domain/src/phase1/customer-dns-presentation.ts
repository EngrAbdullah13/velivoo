import { canonicalDnsName } from "./dns.js";

export interface CustomerDnsCopyField {
  key: string;
  label: string;
  value: string;
  hint?: string;
}

export interface CustomerDnsPresentation {
  title: string;
  instructions: string;
  host: { label: string; value: string; fullName: string };
  fields: CustomerDnsCopyField[];
}

export function parseMxExpectedValue(value: string) {
  const trimmed = value.trim();
  const match = /^(\d+)\s+(\S+)$/.exec(trimmed);
  if (!match) return null;
  return { priority: Number(match[1]), mailServer: match[2]!.replace(/\.$/, "") };
}

/** Hostinger/cPanel-style host: relative label when possible. */
export function dnsHostForProvider(fullName: string, rootDomain: string) {
  const name = canonicalDnsName(fullName);
  const root = canonicalDnsName(rootDomain);
  if (!name || !root) return { value: fullName, fullName };
  if (name === root) return { value: "@", fullName: name };
  if (name.endsWith(`.${root}`)) return { value: name.slice(0, -(root.length + 1)), fullName: name };
  return { value: name, fullName: name };
}

const purposeTitles: Record<string, string> = {
  ownership: "Domain ownership (TXT)",
  send_routing: "Send routing (CNAME)",
  dkim_vm1: "DKIM vm1 (CNAME)",
  dkim_vm2: "DKIM vm2 (CNAME)",
  mail_from_mx: "Return path mail server (MX)",
  mail_from_spf: "Return path SPF (TXT)",
};

export function presentCustomerDnsRecord(input: {
  type: string;
  name: string;
  value: string;
  purpose?: string | null;
  rootDomain: string;
}): CustomerDnsPresentation {
  const purpose = String(input.purpose ?? "").toLowerCase();
  const type = input.type.toUpperCase();
  const host = dnsHostForProvider(input.name, input.rootDomain);
  const title = purposeTitles[purpose] ?? `${type} record`;

  if (purpose === "mail_from_mx" || (type === "MX" && purpose.includes("mail_from"))) {
    const parsed = parseMxExpectedValue(input.value);
    const mailServer = parsed?.mailServer ?? input.value.replace(/^\d+\s+/, "").trim();
    const priority = parsed?.priority ?? 10;
    return {
      title,
      instructions:
        "Add one MX record for your return path. Most DNS panels (Hostinger, GoDaddy, Cloudflare) have separate Priority and Mail server fields — do not type the priority inside the mail server box.",
      host: { label: "Host / Name", ...host },
      fields: [
        {
          key: "priority",
          label: "Priority",
          value: String(priority),
          hint: "Use the provider's Priority field only.",
        },
        {
          key: "mailServer",
          label: "Mail server / Points to",
          value: mailServer,
          hint: "Copy only this hostname — no number at the start.",
        },
      ],
    };
  }

  if (purpose === "mail_from_spf" || (type === "TXT" && purpose.includes("mail_from"))) {
    return {
      title,
      instructions: "Add one TXT record on the same host as the return-path MX record.",
      host: { label: "Host / Name", ...host },
      fields: [{ key: "txt", label: "TXT value", value: input.value.replace(/^"|"$/g, "") }],
    };
  }

  if (type === "CNAME") {
    return {
      title,
      instructions: "Add one CNAME record exactly as shown.",
      host: { label: "Host / Name", ...host },
      fields: [{ key: "target", label: "Points to / Target", value: input.value.replace(/\.$/, "") }],
    };
  }

  if (type === "TXT") {
    return {
      title,
      instructions: purpose === "ownership" ? "Add one TXT record at your domain root (@)." : "Add one TXT record exactly as shown.",
      host: { label: "Host / Name", ...host },
      fields: [{ key: "txt", label: "TXT value", value: input.value.replace(/^"|"$/g, "") }],
    };
  }

  if (type === "MX") {
    const parsed = parseMxExpectedValue(input.value);
    return {
      title,
      instructions: "Add one MX record. Keep priority and mail server in separate fields.",
      host: { label: "Host / Name", ...host },
      fields: parsed
        ? [
            { key: "priority", label: "Priority", value: String(parsed.priority) },
            { key: "mailServer", label: "Mail server", value: parsed.mailServer },
          ]
        : [{ key: "value", label: "Value", value: input.value }],
    };
  }

  return {
    title,
    instructions: "Add this DNS record exactly as shown.",
    host: { label: "Host / Name", ...host },
    fields: [{ key: "value", label: "Value", value: input.value }],
  };
}
