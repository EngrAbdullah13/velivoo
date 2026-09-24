import type { analyticsRecipientsExport } from "./analytics-dashboard.js";

type RecipientExport = Awaited<ReturnType<typeof analyticsRecipientsExport>>;

function cell(value: unknown) {
  const raw = value instanceof Date ? value.toISOString() : value === null || value === undefined ? "" : String(value);
  const safe = /^[\s]*[=+@\-]/.test(raw) ? `'${raw}` : raw;
  return /[",\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export function analyticsRecipientsCsv(report: RecipientExport) {
  const header = ["name", "phone_number", "email", "email_opened", "link_clicked", "unsubscribed", "email_name", "sent_at"];
  const rows = report.rows.map(row => [row.name, row.phone, row.email, row.opened ? "yes" : "no", row.clicked ? "yes" : "no", row.unsubscribed === null ? "" : row.unsubscribed ? "yes" : "no", row.emailName, row.sentAt].map(cell).join(","));
  return `\uFEFF${[header.join(","), ...rows].join("\r\n")}`;
}
