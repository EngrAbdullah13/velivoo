import { createHash, randomUUID } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import type { ContentBlock, EmailTextStyle, StructuredEmailDocument, StructuredBlock } from "./content.js";

export type TemplateImportMethod = "html_upload" | "zip_upload" | "pasted_html";
export type TemplateType = "native" | "imported_html" | "converted_import";
export type ConversionStatus = "not_requested" | "converted" | "partial" | "failed";

export interface ImportWarning {
  code: string;
  severity: "warning" | "error";
  message: string;
}

export interface ImportProcessingStats {
  imagesImported: number;
  externalImages: number;
  buttonsDetected: number;
  linksDetected: number;
  unsupportedRemoved: number;
}

export interface ImportProcessResult {
  sessionId: string;
  previewHtml: string;
  sanitizedHtml: string;
  plainText: string;
  subjectSuggestion: string;
  preheaderSuggestion: string;
  warnings: ImportWarning[];
  stats: ImportProcessingStats;
  htmlFileChoices?: string[];
  conversionReport?: {
    blocksCreated: number;
    customHtmlSections: number;
    reviewSections: number;
  };
}

const MAX_HTML_BYTES = 5 * 1024 * 1024;
const MAX_ZIP_BYTES = 10 * 1024 * 1024;
const MAX_ZIP_EXTRACTED_BYTES = 25 * 1024 * 1024;
const MAX_ZIP_FILES = 50;
const UNSAFE_URL = /^\s*(javascript:|data:text\/html|vbscript:)/i;
const EVENT_HANDLER = /\son[a-z]+\s*=/gi;
const SCRIPT_TAG = /<script\b[^>]*>[\s\S]*?<\/script>/gi;
const IFRAME_TAG = /<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi;
const FORM_TAG = /<form\b[^>]*>[\s\S]*?<\/form>/gi;
const EMBED_TAG = /<embed\b[^>]*\/?>/gi;
const OBJECT_TAG = /<object\b[^>]*>[\s\S]*?<\/object>/gi;
const LINK_STYLESHEET = /<link\b[^>]*rel\s*=\s*["']?stylesheet["']?[^>]*>/gi;
const META_REFRESH = /<meta\b[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*>/gi;

export function assertHtmlSize(html: string, maxBytes = MAX_HTML_BYTES): void {
  if (Buffer.byteLength(html, "utf8") > maxBytes) throw new Error("IMPORT_HTML_TOO_LARGE");
}

export function assertZipSize(bytes: Uint8Array, maxBytes = MAX_ZIP_BYTES): void {
  if (bytes.byteLength > maxBytes) throw new Error("IMPORT_ZIP_TOO_LARGE");
}

function normalizeZipPath(raw: string): string | null {
  const normalized = raw.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.includes("..") || /^[a-zA-Z]:/.test(normalized)) return null;
  return normalized;
}

interface ZipEntry { path: string; data: Buffer }

export function extractSafeZip(buffer: Buffer): ZipEntry[] {
  const entries: ZipEntry[] = [];
  let offset = 0;
  let extracted = 0;
  while (offset + 30 <= buffer.length) {
    const sig = buffer.readUInt32LE(offset);
    if (sig !== 0x04034b50) break;
    const compression = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const fileNameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const nameEnd = nameStart + fileNameLength;
    if (nameEnd > buffer.length) throw new Error("IMPORT_ZIP_CORRUPT");
    const rawName = buffer.subarray(nameStart, nameEnd).toString("utf8");
    const path = normalizeZipPath(rawName);
    if (!path) throw new Error("IMPORT_ZIP_UNSAFE_PATH");
    const dataStart = nameEnd + extraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > buffer.length) throw new Error("IMPORT_ZIP_CORRUPT");
    if (!path.endsWith("/")) {
      if (entries.length >= MAX_ZIP_FILES) throw new Error("IMPORT_ZIP_TOO_MANY_FILES");
      let data = buffer.subarray(dataStart, dataEnd);
      if (compression === 8) {
        try { data = inflateRawSync(data); } catch { throw new Error("IMPORT_ZIP_CORRUPT"); }
      } else if (compression !== 0) throw new Error("IMPORT_ZIP_UNSUPPORTED_COMPRESSION");
      extracted += data.byteLength;
      if (extracted > MAX_ZIP_EXTRACTED_BYTES) throw new Error("IMPORT_ZIP_EXTRACTED_TOO_LARGE");
      entries.push({ path, data });
    }
    offset = dataEnd;
  }
  if (!entries.length) throw new Error("IMPORT_ZIP_EMPTY");
  return entries;
}

export function pickPrimaryHtmlFiles(entries: ZipEntry[]): string[] {
  return entries
    .filter(entry => /\.html?$/i.test(entry.path) && entry.data.byteLength > 0)
    .map(entry => entry.path)
    .sort((a, b) => {
      const score = (p: string) => (/(^|\/)index\.html?$/i.test(p) ? 0 : /email|template|message/i.test(p) ? 1 : 2);
      return score(a) - score(b) || a.localeCompare(b);
    });
}

function stripEventHandlers(html: string): { html: string; removed: number } {
  let removed = 0;
  const cleaned = html.replace(EVENT_HANDLER, () => { removed += 1; return " data-removed-handler="; });
  return { html: cleaned, removed };
}

function sanitizeHref(html: string): { html: string; removed: number } {
  let removed = 0;
  const cleaned = html.replace(/\s(href|src|xlink:href)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi, (match, attr, _q, d1, d2, d3) => {
    const value = (d1 ?? d2 ?? d3 ?? "").trim();
    if (UNSAFE_URL.test(value)) { removed += 1; return ` ${attr}="#"`; }
    return match;
  });
  return { html: cleaned, removed };
}

export function sanitizeImportedHtml(source: string): { html: string; warnings: ImportWarning[]; stats: ImportProcessingStats } {
  assertHtmlSize(source);
  const warnings: ImportWarning[] = [];
  let html = source.replace(/^\uFEFF/, "");
  let unsupportedRemoved = 0;

  const scriptMatches = html.match(SCRIPT_TAG);
  if (scriptMatches?.length) {
    unsupportedRemoved += scriptMatches.length;
    warnings.push({ code: "SCRIPT_REMOVED", severity: "warning", message: scriptMatches.length === 1 ? "One script was removed because email clients do not support JavaScript." : `${scriptMatches.length} scripts were removed because email clients do not support JavaScript.` });
    html = html.replace(SCRIPT_TAG, "");
  }
  for (const [pattern, label] of [[IFRAME_TAG, "iframe"], [FORM_TAG, "form"], [EMBED_TAG, "embed"], [OBJECT_TAG, "object"], [META_REFRESH, "meta refresh"]] as const) {
    const matches = html.match(pattern);
    if (matches?.length) {
      unsupportedRemoved += matches.length;
      warnings.push({ code: "UNSUPPORTED_TAG_REMOVED", severity: "warning", message: `${matches.length} unsupported ${label} element${matches.length === 1 ? " was" : "s were"} removed.` });
      html = html.replace(pattern, "");
    }
  }
  const stylesheetMatches = html.match(LINK_STYLESHEET);
  if (stylesheetMatches?.length) {
    warnings.push({ code: "EXTERNAL_STYLESHEET_PREVIEW", severity: "warning", message: "External stylesheets are retained for the isolated editor preview. Inline critical CSS is still recommended for delivered email." });
  }

  const handlers = stripEventHandlers(html);
  html = handlers.html;
  if (handlers.removed) {
    unsupportedRemoved += handlers.removed;
    warnings.push({ code: "EVENT_HANDLERS_REMOVED", severity: "warning", message: "Inline event handlers were removed for email safety." });
  }
  const urls = sanitizeHref(html);
  html = urls.html;
  if (urls.removed) {
    unsupportedRemoved += urls.removed;
    warnings.push({ code: "UNSAFE_URL_REMOVED", severity: "warning", message: "Unsafe link or image URLs were neutralized." });
  }

  html = html.replace(/@import[^;]+;/gi, "");
  html = html.replace(/font-family\s*:\s*([^;}{]+)/gi, (match, fonts: string) => {
    if (/webfont|woff|googleapis|typekit|custom/i.test(fonts)) {
      warnings.push({ code: "FONT_FALLBACK", severity: "warning", message: "A custom font was replaced with an email-safe fallback font." });
      return "font-family: Arial, Helvetica, sans-serif";
    }
    return match;
  });

  const stats = analyzeHtml(html);
  stats.unsupportedRemoved = unsupportedRemoved;
  if (stats.externalImages) {
    warnings.push({ code: "EXTERNAL_IMAGES", severity: "warning", message: `${stats.externalImages} image${stats.externalImages === 1 ? " uses an" : "s use"} external URL${stats.externalImages === 1 ? "" : "s"}. They will remain externally hosted.` });
  }
  if (html.includes("mso-") || html.includes("Outlook")) {
    warnings.push({ code: "OUTLOOK_LAYOUT", severity: "warning", message: "Some advanced layout may look different in Outlook." });
  }
  if (Buffer.byteLength(html, "utf8") > MAX_HTML_BYTES) throw new Error("IMPORT_HTML_TOO_LARGE");

  return { html: html.trim(), warnings, stats };
}

export function analyzeHtml(html: string): ImportProcessingStats {
  const imgTags = [...html.matchAll(/<img\b[^>]*>/gi)];
  let externalImages = 0;
  let missingAlt = 0;
  for (const tag of imgTags) {
    const src = tag[0].match(/\ssrc\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const value = (src?.[2] ?? src?.[3] ?? src?.[4] ?? "").trim();
    if (value.startsWith("http://") || value.startsWith("https://")) externalImages += 1;
    if (!/\salt\s*=\s*("[^"]+"|'[^']+'|[^\s>]+)/i.test(tag[0])) missingAlt += 1;
  }
  const buttonsDetected = [...html.matchAll(/<a\b[^>]*>\s*(?:<[^>]+>\s*)*[^<]{0,80}<\/a>/gi)].filter(m => /button|cta|btn|background-color|padding:\s*\d/i.test(m[0])).length;
  const linksDetected = [...html.matchAll(/<a\b[^>]*href\s*=/gi)].length;
  return {
    imagesImported: imgTags.length - externalImages,
    externalImages,
    buttonsDetected,
    linksDetected,
    unsupportedRemoved: 0,
  };
}

export function htmlToPlainText(html: string): string {
  return html
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeQuotedPrintable(input: string): string {
  return input
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)));
}

function decodePartBody(body: string, encoding: string): string {
  const normalized = encoding.toLowerCase();
  if (normalized.includes("base64")) {
    try { return Buffer.from(body.replace(/\s+/g, ""), "base64").toString("utf8"); } catch { return body; }
  }
  if (normalized.includes("quoted-printable")) return decodeQuotedPrintable(body);
  return body;
}

function parseMimeHeaders(section: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of section.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const match = line.match(/^([\w-]+):\s*(.*)$/);
    if (!match?.[1]) continue;
    const key = match[1].toLowerCase();
    headers[key] = headers[key] ? `${headers[key]} ${match[2] ?? ""}` : (match[2] ?? "").trim();
  }
  return headers;
}

function extractBoundary(contentType: string): string | null {
  const match = contentType.match(/boundary\s*=\s*"([^"]+)"|boundary\s*=\s*([^\s;]+)/i);
  return match?.[1] ?? match?.[2] ?? null;
}

function looksLikeRawEmail(source: string): boolean {
  const { headers: headerSection } = splitHeadersAndBody(source.replace(/^\uFEFF/, ""));
  if (/<html[\s>]/i.test(headerSection)) return false;
  const head = headerSection.slice(0, 4000);
  const signals = [/^(?:Delivered-To|Return-Path|Received|DKIM-Signature|MIME-Version|Message-ID):/im, /^Subject:/im, /^Content-Type:\s*multipart\//im, /^Content-Type:\s*text\/html/im];
  return signals.filter(pattern => pattern.test(head)).length >= 2;
}

function splitHeadersAndBody(source: string): { headers: string; body: string } {
  const lines = source.split(/\r?\n/);
  let index = 0;
  const headerLines: string[] = [];
  while (index < lines.length) {
    const line = lines[index]!;
    if (!line.trim()) {
      index += 1;
      break;
    }
    headerLines.push(line);
    index += 1;
  }
  return { headers: headerLines.join("\n"), body: lines.slice(index).join("\n") };
}

function extractHtmlFromMime(source: string): { html: string | null; subject: string | null } {
  const normalized = source.replace(/^\uFEFF/, "");
  const { headers: headerSection, body } = splitHeadersAndBody(normalized);
  const headers = parseMimeHeaders(headerSection);
  const subject = headers.subject?.replace(/^"(.*)"$/, "$1") ?? null;
  const contentType = headers["content-type"] ?? "";

  if (/text\/html/i.test(contentType) && !/multipart/i.test(contentType)) {
    const encoding = headers["content-transfer-encoding"] ?? "";
    const html = decodePartBody(body.trim(), encoding);
    return { html: /<html[\s>]/i.test(html) || /<body[\s>]/i.test(html) || /<table[\s>]/i.test(html) ? html : null, subject };
  }

  const boundary = extractBoundary(contentType);
  if (!boundary) return { html: null, subject };

  const delimiter = `--${boundary}`;
  const parts = body.split(delimiter).map(part => part.replace(/^[\r\n]+|[\r\n]+$/g, "").replace(/^--[\r\n]*$/g, "").trim()).filter(Boolean);
  let html: string | null = null;
  for (const part of parts) {
    const partSplit = part.match(/\r?\n\r?\n/);
    if (partSplit?.index === undefined) continue;
    const partHeaders = parseMimeHeaders(part.slice(0, partSplit.index));
    const partType = partHeaders["content-type"] ?? "";
    if (!/text\/html/i.test(partType)) continue;
    const partBody = part.slice(partSplit.index).replace(/^\r?\n\r?\n/, "").trim();
    const decoded = decodePartBody(partBody, partHeaders["content-transfer-encoding"] ?? "");
    if (/<html[\s>]/i.test(decoded) || /<body[\s>]/i.test(decoded) || /<table[\s>]/i.test(decoded)) {
      html = decoded;
      break;
    }
  }
  return { html, subject };
}

export function normalizeImportSource(source: string): { html: string; subject?: string; warnings: ImportWarning[] } {
  const trimmed = source.replace(/^\uFEFF/, "").trim();
  if (!trimmed) throw new Error("IMPORT_HTML_EMPTY");

  if (looksLikeRawEmail(trimmed)) {
    const extracted = extractHtmlFromMime(trimmed);
    if (!extracted.html) {
      throw new Error("IMPORT_EMAIL_SOURCE_NO_HTML");
    }
    return {
      html: extracted.html,
      subject: extracted.subject ?? undefined,
      warnings: [{
        code: "EMAIL_SOURCE_EXTRACTED",
        severity: "warning",
        message: "This looked like a full email message (Show original / .eml). We extracted the HTML body and ignored delivery headers.",
      }],
    };
  }

  if (!/<(?:html|body|table|div|p|center|td|tr|meta|!DOCTYPE)/i.test(trimmed)) {
    throw new Error("IMPORT_HTML_INVALID");
  }

  return { html: trimmed, warnings: [] };
}

function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match?.[1]?.replace(/<[^>]+>/g, "").trim() ?? "";
}

function extractPreheader(html: string): string {
  const hidden = html.match(/<(?:div|span|td)[^>]*style\s*=\s*["'][^"']*display\s*:\s*none[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|span|td)>/i);
  const text = hidden?.[1]?.replace(/<[^>]+>/g, "").trim();
  if (text && text.length <= 200) return text;
  const first = htmlToPlainText(html).split("\n").map(line => line.trim()).find(line => line && !/^(Delivered-To|Return-Path|Received|DKIM-Signature):/i.test(line));
  return first ? first.slice(0, 140) : "";
}

export function rewriteImageSources(html: string, mapping: Record<string, string>): string {
  return html.replace(/(<img\b[^>]*\ssrc\s*=\s*)(["'])([^"']+)\2/gi, (match, prefix, quote, src) => {
    const next = mapping[src] ?? mapping[src.replace(/^\.\//, "")] ?? mapping[decodeURIComponent(src)];
    return next ? `${prefix}${quote}${next}${quote}` : match;
  });
}

export function buildImportedHtmlDocument(html: string): StructuredEmailDocument {
  return {
    schemaVersion: 1,
    blocks: [
      { id: "imported-html", type: "custom_html", html, label: "Imported HTML" },
      { id: "compliance", type: "compliance_footer", locked: true },
    ],
  };
}

function blockId(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

function extractBodyHtml(html: string): string {
  const match = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  return (match?.[1] ?? html).trim();
}

function attrValue(attrs: string, name: string): string {
  const quoted = attrs.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*"([^"]*)"`, "i"));
  if (quoted?.[1]) return quoted[1].trim();
  const singleQuoted = attrs.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*'([^']*)'`, "i"));
  if (singleQuoted?.[1]) return singleQuoted[1].trim();
  const bare = attrs.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*([^\\s>"']+)`, "i"));
  return bare?.[1]?.trim() ?? "";
}

function wrapBareTableCellContent(html: string): string {
  return html.replace(/<t[dh]([^>]*)>([\s\S]*?)<\/t[dh]>/gi, (_, attrs, inner) => {
    const trimmed = inner.trim();
    if (!trimmed) return "";
    if (/^<(h[1-6]|p|div|img|a|hr|table|ul|ol|blockquote)\b/i.test(trimmed)) return `<td${attrs}>${inner}</td>`;
    if (/<(?:h[1-6]|p|div|table|ul|ol|img|a)\b/i.test(trimmed)) return `<td${attrs}>${inner}</td>`;
    const style = attrValue(attrs, "style");
    const paragraphStyle = style ? ` style="${style.replace(/"/g, "&quot;")}"` : "";
    return `<td${attrs}><p${paragraphStyle}>${trimmed}</p></td>`;
  });
}

function flattenEmailLayout(html: string): string {
  return wrapBareTableCellContent(html)
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\/?(?:table|tbody|thead|tfoot|colgroup|col|tr)[^>]*>/gi, "\n")
    .replace(/<t[dh][^>]*>/gi, "\n")
    .replace(/<\/t[dh]>/gi, "\n")
    .replace(/<(?:div|section|center|article|main)[^>]*>/gi, "\n")
    .replace(/<\/(?:div|section|center|article|main)>/gi, "\n");
}

function parseCssColor(value: string): string | undefined {
  const trimmed = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) return trimmed;
  const rgb = trimmed.match(/^rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i);
  if (rgb?.[1] && rgb[2] && rgb[3]) {
    const hex = [rgb[1], rgb[2], rgb[3]].map(part => Number(part).toString(16).padStart(2, "0")).join("");
    return `#${hex}`;
  }
  return undefined;
}

function parseCssSize(value: string): number | undefined {
  const px = value.trim().match(/^(\d+(?:\.\d+)?)px$/i);
  if (px?.[1]) return Number(px[1]);
  const num = value.trim().match(/^(\d+(?:\.\d+)?)$/);
  return num?.[1] ? Number(num[1]) : undefined;
}

function parseInlineTextStyle(attrs: string): EmailTextStyle | undefined {
  const styleAttr = attrValue(attrs, "style");
  if (!styleAttr) return undefined;
  const style: EmailTextStyle = {};
  for (const rule of styleAttr.split(";")) {
    const colon = rule.indexOf(":");
    if (colon <= 0) continue;
    const key = rule.slice(0, colon).trim().toLowerCase();
    const value = rule.slice(colon + 1).trim();
    if (key === "color") {
      const color = parseCssColor(value);
      if (color) style.color = color;
    } else if (key === "font-size") {
      const fontSize = parseCssSize(value);
      if (fontSize) style.fontSize = fontSize;
    } else if (key === "line-height") {
      const lineHeight = parseCssSize(value) ?? Number(value);
      if (Number.isFinite(lineHeight) && lineHeight > 0) style.lineHeight = lineHeight;
    } else if (key === "font-family") {
      const lower = value.toLowerCase();
      style.fontFamily = lower.includes("georgia") ? "Georgia, serif" : lower.includes("helvetica") ? "Helvetica, Arial, sans-serif" : "Arial, sans-serif";
    } else if (key === "font-weight" && /^(bold|[6-9]00)/i.test(value)) {
      style.fontWeight = "bold";
    } else if (key === "font-style" && /italic/i.test(value)) {
      style.italic = true;
    }
  }
  return Object.keys(style).length ? style : undefined;
}

function parseAlign(attrs: string): "left" | "center" | "right" | undefined {
  const align = attrValue(attrs, "align").toLowerCase();
  if (align === "center" || align === "right") return align;
  const style = attrValue(attrs, "style").toLowerCase();
  if (/text-align\s*:\s*center/.test(style)) return "center";
  if (/text-align\s*:\s*right/.test(style)) return "right";
  return undefined;
}

export function isSingleCustomHtmlImport(document: StructuredEmailDocument): boolean {
  const content = document.blocks.filter(block => block.type !== "compliance_footer");
  return content.length === 1 && content[0]?.type === "custom_html";
}

function stripNonContentForConversion(html: string): string {
  const body = annotateElementsWithCellStyles(extractBodyHtml(html)
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<div\b[^>]*class\s*=\s*["'][^"']*preheader[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, "")
    .replace(/<div\b[^>]*class\s*=\s*["'][^"']*preheader[^"']*["'][^>]*\/>/gi, ""));
  return flattenEmailLayout(body);
}

function prepareBodyForConversion(html: string): string {
  return annotateElementsWithCellStyles(extractBodyHtml(html)
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<div\b[^>]*class\s*=\s*["'][^"']*preheader[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, "")
    .replace(/<div\b[^>]*class\s*=\s*["'][^"']*preheader[^"']*["'][^>]*\/>/gi, ""));
}

function extractTableElement(html: string, startIndex: number): string | null {
  const lower = html.toLowerCase();
  const tagEnd = html.indexOf(">", startIndex);
  if (tagEnd < 0) return null;
  let depth = 1;
  let cursor = tagEnd + 1;
  while (cursor < html.length && depth > 0) {
    const nextOpen = lower.indexOf("<table", cursor);
    const nextClose = lower.indexOf("</table", cursor);
    if (nextClose < 0) break;
    if (nextOpen >= 0 && nextOpen < nextClose) {
      depth += 1;
      cursor = nextOpen + 6;
    } else {
      depth -= 1;
      cursor = nextClose + 8;
    }
  }
  return depth === 0 ? html.slice(startIndex, cursor) : null;
}

function findEmailShellTable(html: string): string | null {
  const marker = html.search(/<table\b[^>]*(?:class\s*=\s*["'][^"']*email-shell[^"']*"|width\s*=\s*["']620["'])/i);
  if (marker < 0) return null;
  return extractTableElement(html, marker);
}

function extractMainTableInner(html: string): string | null {
  const shell = findEmailShellTable(html);
  if (shell) return shell.match(/^<table\b[^>]*>([\s\S]*)<\/table>$/i)?.[1] ?? null;
  const lower = html.toLowerCase();
  let index = 0;
  let best: { inner: string; score: number } | null = null;
  while (index < html.length) {
    const start = lower.indexOf("<table", index);
    if (start < 0) break;
    const tableHtml = extractTableElement(html, start);
    if (!tableHtml) break;
    const attrs = tableHtml.match(/^<table\b([^>]*)>/i)?.[1] ?? "";
    const inner = tableHtml.match(/^<table\b[^>]*>([\s\S]*)<\/table>$/i)?.[1] ?? "";
    const rows = splitTopLevelTableRows(inner).length;
    const widthToken = attrValue(attrs, "width") || attrs.match(/width\s*:\s*(\d{3,4})/i)?.[1] || "";
    const width = Number(widthToken.replace(/\D/g, ""));
    let score = rows * 12 + inner.length / 120;
    if (width >= 480 && width <= 760) score += 80;
    if (!best || score > best.score) best = { inner, score };
    index = start + tableHtml.length;
  }
  return best?.inner ?? null;
}

function splitTopLevelTableRows(html: string): string[] {
  const rows: string[] = [];
  const lower = html.toLowerCase();
  let index = 0;
  while (index < html.length) {
    const trStart = lower.indexOf("<tr", index);
    if (trStart < 0) break;
    const tagEnd = html.indexOf(">", trStart);
    if (tagEnd < 0) break;
    let depth = 1;
    let cursor = tagEnd + 1;
    while (cursor < html.length && depth > 0) {
      const nextOpen = lower.indexOf("<tr", cursor);
      const nextClose = lower.indexOf("</tr", cursor);
      if (nextClose < 0) break;
      if (nextOpen >= 0 && nextOpen < nextClose) {
        depth += 1;
        cursor = nextOpen + 3;
      } else {
        depth -= 1;
        cursor = nextClose + 5;
      }
    }
    if (depth !== 0) break;
    const row = html.slice(trStart, cursor);
    const text = htmlTextContent(row).replace(/\s+/g, " ").trim();
    if (text.length >= 2 || /<img\b/i.test(row)) rows.push(row);
    index = cursor;
  }
  return rows;
}

function splitEmailTableRows(html: string): string[] {
  const inner = extractMainTableInner(html);
  if (!inner) return [];
  return splitTopLevelTableRows(inner);
}

function rowNeedsSectionPreserve(rowHtml: string): boolean {
  const nestedTables = (rowHtml.match(/<table\b/gi) ?? []).length;
  const cells = (rowHtml.match(/<t[dh]\b/gi) ?? []).length;
  const backgrounds = (rowHtml.match(/background(?:-color)?\s*:/gi) ?? []).length;
  if (nestedTables > 0) return true;
  if (cells >= 2 && backgrounds >= 2) return true;
  if (cells >= 2 && rowHtml.length > 350) return true;
  return false;
}

function wrapSectionHtml(rowHtml: string): string {
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;width:100%;"><tbody>${rowHtml}</tbody></table>`;
}

function sectionLabelFromRow(rowHtml: string): string {
  const heading = rowHtml.match(/<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/i);
  if (heading?.[1]) {
    const text = htmlTextContent(heading[1]).replace(/\s+/g, " ").trim();
    if (text) return text.slice(0, 48);
  }
  const firstText = htmlTextContent(rowHtml).replace(/\s+/g, " ").trim();
  return firstText.slice(0, 40) || "Email section";
}

function extractBackgroundColor(style: string): string | undefined {
  return parseCssColor(style.match(/(?:background-color|background)\s*:\s*([^;]+)/i)?.[1] ?? "");
}

export function extractTemplateDesignFromHtml(html: string): {
  backgroundColor?: string;
  bodyBackgroundColor?: string;
  emailWidth?: number;
} {
  const bodyTag = html.match(/<body\b([^>]*)>/i)?.[1] ?? "";
  const bodyStyle = attrValue(bodyTag, "style");
  const outerBg = extractBackgroundColor(bodyStyle);
  const widthPatterns = [
    html.match(/<table\b[^>]*\bwidth\s*=\s*["']?(\d{3,4})\b/i),
    html.match(/\bwidth\s*:\s*(\d{3,4})px/i),
    html.match(/\bmax-width\s*:\s*(\d{3,4})px/i),
  ];
  let emailWidth: number | undefined;
  for (const match of widthPatterns) {
    const value = Number(match?.[1]);
    if (Number.isFinite(value) && value >= 480 && value <= 760) {
      emailWidth = value;
      break;
    }
  }
  return {
    backgroundColor: outerBg ?? "#f4f5f0",
    bodyBackgroundColor: "#ffffff",
    emailWidth: emailWidth ?? 600,
  };
}

function annotateLeafCell(inner: string, background: string, tdStyle: string, tdAttrs: string): string {
  const trimmed = inner.trim();
  if (trimmed && !/<(?:h[1-6]|p|div|a|img|table|ul|ol)\b/i.test(trimmed)) {
    const text = htmlTextContent(trimmed);
    if (text) return `<td${tdAttrs}><p data-cell-bg="${background}" style="${tdStyle.replace(/"/g, "&quot;")}">${text}</p></td>`;
  }
  const annotated = inner.replace(/<(h[1-6]|p|div|a)\b([^>]*)>/gi, (match, _tag, attrs) => {
    if (/data-cell-bg=/.test(attrs)) return match;
    return match.replace(/>$/, ` data-cell-bg="${background}">`);
  });
  return `<td${tdAttrs}>${annotated}</td>`;
}

function annotateElementsWithCellStyles(html: string): string {
  let output = html;
  let changed = true;
  while (changed) {
    changed = false;
    output = output.replace(/<t[dh]([^>]*)>([\s\S]*?)<\/t[dh]>/gi, (match, tdAttrs, inner) => {
      if (/<t[dh]\b/i.test(inner)) return match;
      const tdStyle = attrValue(tdAttrs, "style");
      const background = extractBackgroundColor(tdStyle) ?? "";
      if (!background || /data-cell-bg=/.test(inner)) return match;
      changed = true;
      return annotateLeafCell(inner, background, tdStyle, tdAttrs);
    });
  }
  return output;
}

function cellBackground(attrs: string): string | undefined {
  return parseCssColor(attrValue(attrs, "data-cell-bg")) ?? undefined;
}

function htmlTextContent(inner: string): string {
  return inner
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

function isLeafDiv(inner: string): boolean {
  return !/<(?:div|table|tbody|thead|tfoot|tr|td|p|h[1-6]|ul|ol|li|blockquote)\b/i.test(inner);
}

function isButtonAnchor(attrs: string): boolean {
  const style = attrValue(attrs, "style").toLowerCase();
  const cls = attrValue(attrs, "class").toLowerCase();
  if (/\b(?:cta|button|btn)\b/.test(cls)) return true;
  const hasBackground = /(?:^|;)\s*background(?:-color)?\s*:/.test(style);
  const hasPadding = /padding\s*:/.test(style);
  return hasBackground && hasPadding;
}

function headingLevelFromSize(fontSize: number): 1 | 2 | 3 {
  if (fontSize >= 30) return 1;
  if (fontSize >= 22) return 2;
  return 3;
}

function textBlockFromAttrs(attrs: string, text: string, fallbackSize = 16): ContentBlock {
  const style = parseInlineTextStyle(attrs) ?? { fontFamily: "Arial, sans-serif", fontSize: fallbackSize, lineHeight: fallbackSize >= 22 ? 1.25 : 1.5 };
  return { id: blockId("text"), type: "text", text: text || " ", align: parseAlign(attrs), style, backgroundColor: cellBackground(attrs) };
}

function headingBlockFromAttrs(attrs: string, text: string, level: 1 | 2 | 3): ContentBlock {
  const style = parseInlineTextStyle(attrs) ?? { fontFamily: "Arial, sans-serif", fontSize: level === 1 ? 32 : level === 2 ? 26 : 22, lineHeight: 1.25 };
  return { id: blockId("heading"), type: "heading", level, text: text || "Heading", align: parseAlign(attrs), style, backgroundColor: cellBackground(attrs) };
}

function scanHtmlToBlocks(html: string): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  let pos = 0;
  while (pos < html.length) {
    const rest = html.slice(pos);
    const whitespace = rest.match(/^[\s\u00a0]+/);
    if (whitespace) { pos += whitespace[0].length; continue; }
    const comment = rest.match(/^<!--[\s\S]*?-->/);
    if (comment) { pos += comment[0].length; continue; }
    const skipTag = rest.match(/^<(?:\/?)(?:table|tbody|thead|tfoot|tr|td|th|colgroup|col|center|span|strong|em|b|i)(?:\s[^>]*)?\/?>/i);
    if (skipTag) { pos += skipTag[0].length; continue; }

    let matched = false;
    for (let level = 1; level <= 6; level += 1) {
      const match = rest.match(new RegExp(`^<h${level}\\b([^>]*)>([\\s\\S]*?)<\\/h${level}>`, "i"));
      if (!match || match[2] === undefined) continue;
      blocks.push(headingBlockFromAttrs(match[1] ?? "", htmlTextContent(match[2]), Math.min(3, level) as 1 | 2 | 3));
      pos += match[0].length;
      matched = true;
      break;
    }
    if (matched) continue;

    const img = rest.match(/^<img\b([^>]*)\/?>/i);
    if (img) {
      const attrs = img[1] ?? "";
      const width = parseCssSize((attrValue(attrs, "width") || attrValue(attrs, "style").match(/width\s*:\s*([^;]+)/i)?.[1]) ?? "");
      blocks.push({ id: blockId("image"), type: "image", src: attrValue(attrs, "src"), alt: attrValue(attrs, "alt") || "Image", width: width ?? 600, align: parseAlign(attrs) ?? "center" });
      pos += img[0].length;
      continue;
    }

    if (/^<hr\b[^>]*\/?>/i.test(rest)) {
      blocks.push({ id: blockId("divider"), type: "divider" });
      pos += rest.match(/^<hr\b[^>]*\/?>/i)![0]!.length;
      continue;
    }

    const paragraph = rest.match(/^<p\b([^>]*)>([\s\S]*?)<\/p>/i);
    if (paragraph?.[1] !== undefined && paragraph[2] !== undefined) {
      if (/<(?:h[1-6]|p|div|table|ul|ol|img|a)\b/i.test(paragraph[2])) {
        const opening = rest.match(/^<p\b[^>]*>/i);
        if (opening) { pos += opening[0].length; continue; }
      } else {
        blocks.push(textBlockFromAttrs(paragraph[1], htmlTextContent(paragraph[2])));
        pos += paragraph[0].length;
        continue;
      }
    }

    const list = rest.match(/^<(ul|ol)\b([^>]*)>([\s\S]*?)<\/\1>/i);
    if (list?.[2] !== undefined && list[3] !== undefined) {
      const ordered = list[1]?.toLowerCase() === "ol";
      const items = [...list[3].matchAll(/<li\b([^>]*)>([\s\S]*?)<\/li>/gi)];
      const bullets = items.map((item, index) => {
        const text = htmlTextContent(item[2] ?? "");
        return ordered ? `${index + 1}. ${text}` : `• ${text}`;
      }).filter(Boolean).join("\n");
      if (bullets) blocks.push(textBlockFromAttrs(list[2], bullets));
      pos += list[0].length;
      continue;
    }

    const anchor = rest.match(/^<a\b([^>]*)>([\s\S]*?)<\/a>/i);
    if (anchor?.[1] !== undefined && anchor[2] !== undefined) {
      const attrs = anchor[1];
      const label = htmlTextContent(anchor[2]) || "Link";
      const href = attrValue(attrs, "href");
      const style = attrValue(attrs, "style");
      if (isButtonAnchor(attrs)) {
        blocks.push({
          id: blockId("button"),
          type: "button",
          label,
          url: href || "#",
          align: parseAlign(attrs) ?? "center",
          backgroundColor: parseCssColor(style.match(/(?:background-color|background)\s*:\s*([^;]+)/i)?.[1] ?? "") ?? cellBackground(attrs) ?? "#6846ed",
          textColor: parseCssColor(style.match(/(?:^|;)color\s*:\s*([^;]+)/i)?.[1] ?? "") ?? "#ffffff",
        });
      } else {
        const inlineStyle = parseInlineTextStyle(attrs);
        const fontSize = inlineStyle?.fontSize ?? 0;
        const sectionBg = cellBackground(attrs);
        if (fontSize >= 20 || /font-weight\s*:\s*(800|bold|[7-9]00)/i.test(style) || sectionBg) {
          blocks.push({ id: blockId("header"), type: "header", text: label, align: parseAlign(attrs) ?? "left", style: inlineStyle ?? { fontFamily: "Arial, sans-serif", fontSize: 20, fontWeight: "bold" }, backgroundColor: sectionBg });
        } else {
          blocks.push(textBlockFromAttrs(attrs, label));
        }
      }
      pos += anchor[0].length;
      continue;
    }

    const spacerDiv = rest.match(/^<div\b([^>]*)>(?:\s|&nbsp;|<br\s*\/?>)*<\/div>/i);
    if (spacerDiv?.[1]) {
      const style = attrValue(spacerDiv[1], "style");
      const height = parseCssSize(style.match(/(?:^|;)height\s*:\s*([^;]+)/i)?.[1] ?? "")
        ?? parseCssSize(style.match(/(?:^|;)min-height\s*:\s*([^;]+)/i)?.[1] ?? "");
      if (height && height >= 8) {
        blocks.push({ id: blockId("spacer"), type: "spacer", height: Math.min(120, Math.round(height)) });
        pos += spacerDiv[0].length;
        continue;
      }
    }

    const div = rest.match(/^<div\b([^>]*)>([\s\S]*?)<\/div>/i);
    if (div?.[1] !== undefined && div[2] !== undefined && isLeafDiv(div[2]) && !/preheader/i.test(div[1])) {
      const attrs = div[1];
      const text = htmlTextContent(div[2]);
      if (text) {
        const style = parseInlineTextStyle(attrs);
        const fontSize = style?.fontSize ?? 0;
        if (fontSize >= 22 || /font-weight\s*:\s*(800|bold|[7-9]00)/i.test(attrValue(attrs, "style"))) {
          blocks.push(headingBlockFromAttrs(attrs, text, headingLevelFromSize(fontSize || 26)));
        } else {
          blocks.push(textBlockFromAttrs(attrs, text));
        }
      }
      pos += div[0].length;
      continue;
    }

    const textRun = rest.match(/^[^<]+/);
    if (textRun) {
      const text = textRun[0].replace(/\s+/g, " ").trim();
      if (text.length >= 2) blocks.push(textBlockFromAttrs("", text));
      pos += textRun[0].length;
      continue;
    }

    const unknown = rest.match(/^<[^>]+>/);
    if (unknown) { pos += unknown[0].length; continue; }
    break;
  }
  return blocks;
}

export function convertHtmlToBlocks(html: string): { document: StructuredEmailDocument; report: NonNullable<ImportProcessResult["conversionReport"]>; warnings: ImportWarning[] } {
  const warnings: ImportWarning[] = [];
  let customHtmlSections = 0;
  let reviewSections = 0;
  const prepared = prepareBodyForConversion(html);
  const rows = splitEmailTableRows(prepared);
  const scanned: ContentBlock[] = [];

  if (rows.length >= 2) {
    for (const row of rows) {
      if (rowNeedsSectionPreserve(row)) {
        scanned.push({
          id: blockId("section"),
          type: "custom_html",
          html: wrapSectionHtml(row),
          label: sectionLabelFromRow(row),
          needsReview: true,
        });
        customHtmlSections += 1;
        reviewSections += 1;
      } else {
        scanned.push(...scanHtmlToBlocks(flattenEmailLayout(row)));
      }
    }
  } else {
    scanned.push(...scanHtmlToBlocks(stripNonContentForConversion(html)));
  }

  const blocks: StructuredBlock[] = [...scanned];
  const blocksCreated = scanned.length;

  if (!blocks.length) {
    blocks.push({ id: blockId("custom"), type: "custom_html", html, label: "Imported HTML" });
    customHtmlSections = 1;
  }
  blocks.push({ id: "compliance", type: "compliance_footer", locked: true });

  if (customHtmlSections) {
    warnings.push({ code: "CUSTOM_HTML_RETAINED", severity: "warning", message: `${customHtmlSections} section${customHtmlSections === 1 ? "" : "s"} retained as Custom HTML.` });
  }
  if (reviewSections) {
    warnings.push({ code: "REVIEW_SECTIONS", severity: "warning", message: `${reviewSections} section${reviewSections === 1 ? " may" : "s may"} need layout review after conversion.` });
  }

  return {
    document: { schemaVersion: 1, blocks },
    report: { blocksCreated, customHtmlSections, reviewSections },
    warnings,
  };
}

export function processImportedHtml(source: string, method: TemplateImportMethod, filename?: string): Omit<ImportProcessResult, "sessionId"> {
  const normalized = normalizeImportSource(source);
  const { html, warnings: sourceWarnings, subject: mimeSubject } = normalized;
  const { html: sanitized, warnings, stats } = sanitizeImportedHtml(html);
  const plainText = htmlToPlainText(sanitized);
  const subjectSuggestion = mimeSubject || extractTitle(sanitized) || (filename ? filename.replace(/\.(html?|eml)$/i, "").replace(/[-_]+/g, " ") : "Imported template");
  const preheaderSuggestion = extractPreheader(sanitized);
  const allWarnings = [...sourceWarnings, ...warnings];
  if (!plainText) allWarnings.push({ code: "PLAIN_TEXT_EMPTY", severity: "warning", message: "Plain-text content could not be generated automatically. Add a plain-text alternative before sending." });
  return {
    previewHtml: sanitized,
    sanitizedHtml: sanitized,
    plainText,
    subjectSuggestion,
    preheaderSuggestion,
    warnings: allWarnings,
    stats,
  };
}

export function importSessionKey(workspaceId: string, sessionId: string): string {
  return `template-imports/${workspaceId}/${sessionId}.json`;
}

export function hashImportSource(source: string): string {
  return createHash("sha256").update(source).digest("hex");
}
