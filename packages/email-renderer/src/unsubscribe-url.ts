/** Build the public unsubscribe URL on the click/tracking host when available. */
export function buildUnsubscribeUrl(input: { token: string; publicBaseUrl: string; trackingBaseUrl?: string | null }): string {
  const base = (input.trackingBaseUrl ?? input.publicBaseUrl).replace(/\/$/, "");
  return `${base}/unsubscribe/${encodeURIComponent(input.token)}`;
}

/** Legacy query-string URL kept for backward compatibility in tests and old links. */
export function buildLegacyUnsubscribeUrl(publicBaseUrl: string, token: string): string {
  return `${publicBaseUrl.replace(/\/$/, "")}/public/v1/unsubscribe?token=${encodeURIComponent(token)}`;
}

export function emailHasUnsubscribeBlock(html: string, text: string): boolean {
  const haystack = `${html}\n${text}`.toLowerCase();
  return haystack.includes("{{ system.unsubscribe_url") || haystack.includes("system.unsubscribe_url") || /unsubscribe/i.test(haystack);
}
