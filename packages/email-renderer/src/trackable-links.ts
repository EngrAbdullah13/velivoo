import { assertSafeTrackingDestination } from "../../domain/src/phase2/tracking.js";

const TEXT_URL = /https:\/\/[^\s<>"']+/g;
const HREF_URL = /\bhref\s*=\s*(["'])(https:[^"']+)\1/gi;

function trimUrl(value: string) {
  const url = value.replace(/[.,!?;:)\]]+$/, "");
  return { url, trailing: value.slice(url.length) };
}

function decodeAmpersands(value: string) {
  return value.replace(/&(?:amp|#38|#x26);/gi, "&");
}

function escapeAttribute(value: string) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function safeDestination(value: string) {
  try { return assertSafeTrackingDestination(decodeAmpersands(value)); }
  catch { return null; }
}

function linkifyText(value: string) {
  return value.replace(TEXT_URL, (match) => {
    const { url, trailing } = trimUrl(match);
    const safe = safeDestination(url);
    return safe ? `<a href="${escapeAttribute(safe)}">${url}</a>${trailing}` : match;
  });
}

// Only linkify text nodes: URLs inside attributes, existing anchors, and CSS must
// not become nested or broken links. Tag boundaries are scanned with quote state
// because a quoted attribute may itself contain a `>` character.
export function linkifyBareHttpsUrls(html: string) {
  let result = "";
  let index = 0;
  let anchorDepth = 0;
  let rawTextTag = "";
  while (index < html.length) {
    if (html[index] !== "<") {
      const end = html.indexOf("<", index);
      const next = end < 0 ? html.length : end;
      const text = html.slice(index, next);
      result += anchorDepth || rawTextTag ? text : linkifyText(text);
      index = next;
      continue;
    }
    if (html.startsWith("<!--", index)) {
      const end = html.indexOf("-->", index + 4);
      const next = end < 0 ? html.length : end + 3;
      result += html.slice(index, next);
      index = next;
      continue;
    }
    let next = index + 1;
    let quote = "";
    for (; next < html.length; next += 1) {
      const char = html[next]!;
      if (quote) { if (char === quote) quote = ""; }
      else if (char === '"' || char === "'") quote = char;
      else if (char === ">") { next += 1; break; }
    }
    const tag = html.slice(index, next);
    result += tag;
    const match = /^<\s*(\/?)\s*([a-z][a-z0-9-]*)/i.exec(tag);
    if (match) {
      const closing = Boolean(match[1]);
      const name = match[2]!.toLowerCase();
      if (name === "a") anchorDepth = Math.max(0, anchorDepth + (closing ? -1 : 1));
      if (["script", "style", "textarea"].includes(name)) rawTextTag = closing ? "" : name;
    }
    index = next;
  }
  return result;
}

export async function rewriteTrackableContent(
  html: string,
  text: string,
  trackedUrlFor: (destination: string) => Promise<string>,
  shouldSkip: (destination: string) => boolean,
) {
  const linkedHtml = linkifyBareHttpsUrls(html);
  const destinations = [
    ...[...linkedHtml.matchAll(HREF_URL)].map((match) => decodeAmpersands(match[2]!)),
    ...[...text.matchAll(TEXT_URL)].map((match) => decodeAmpersands(trimUrl(match[0]).url)),
  ];
  const tracked = new Map<string, string>();
  for (const destination of destinations) {
    if (shouldSkip(destination)) continue;
    const safe = safeDestination(destination);
    if (!safe) continue;
    if (!tracked.has(safe)) tracked.set(safe, await trackedUrlFor(safe));
  }
  const rewrite = (destination: string) => {
    const safe = safeDestination(destination);
    return safe ? tracked.get(safe) : undefined;
  };
  return {
    html: linkedHtml.replace(HREF_URL, (match, _quote: string, destination: string) => {
      const url = shouldSkip(decodeAmpersands(destination)) ? undefined : rewrite(destination);
      return url ? match.replace(destination, escapeAttribute(url)) : match;
    }),
    text: text.replace(TEXT_URL, (match) => {
      const { url, trailing } = trimUrl(match);
      const replacement = url && !shouldSkip(url) ? rewrite(url) : undefined;
      return `${replacement ?? url}${trailing}`;
    }),
  };
}
