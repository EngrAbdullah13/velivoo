import { normalizeEmail } from "./profile.js";

export interface CsvValidationRow {
  rowNumber: number;
  email?: string;
  valid: boolean;
  errors: string[];
}

export interface CsvPreview {
  headers: string[];
  rows: CsvValidationRow[];
  totals: { total: number; valid: number; invalid: number; duplicateInFile: number };
}

export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') { current += '"'; i++; }
      else quoted = !quoted;
    } else if (ch === "," && !quoted) {
      out.push(current); current = "";
    } else current += ch;
  }
  out.push(current);
  return out;
}

/**
 * Validate the selected email column, not a hard-coded header named `email`.
 * Import setup deliberately permits common headings such as `Email Address`.
 */
export function previewCsv(csv: string, emailHeader = "email"): CsvPreview {
  if (csv.includes("\0")) throw new Error("INVALID_CSV_BINARY_DATA");
  const lines = csv.replace(/^\uFEFF/, "").split(/\r?\n/).filter((x) => x.length > 0);
  if (lines.length === 0) throw new Error("EMPTY_CSV");
  const headers = parseCsvLine(lines[0]!).map((x) => x.trim());
  if (new Set(headers.map((x) => x.toLowerCase())).size !== headers.length) throw new Error("DUPLICATE_HEADERS");
  const selectedEmailHeader = emailHeader.trim().toLowerCase();
  // The upload preview runs before a user has selected a mapping. In that one
  // case, recognize common email headings; validation/commit pass the persisted
  // exact mapping whenever one exists.
  const emailIndex = headers.findIndex((x) => x.toLowerCase() === selectedEmailHeader) >= 0
    ? headers.findIndex((x) => x.toLowerCase() === selectedEmailHeader)
    : selectedEmailHeader === "email"
      ? headers.findIndex((x) => /(^|[ _-])email([ _-]|$)/i.test(x.trim()))
      : -1;
  if (emailIndex < 0) throw new Error("EMAIL_COLUMN_REQUIRED");
  const seen = new Set<string>();
  let duplicateInFile = 0;
  const rows = lines.slice(1).map((line, index) => {
    const values = parseCsvLine(line);
    const errors: string[] = [];
    const raw = values[emailIndex]?.trim() ?? "";
    let email: string | undefined;
    try { email = normalizeEmail(raw); } catch { errors.push("INVALID_EMAIL"); }
    if (email) {
      if (seen.has(email)) { errors.push("DUPLICATE_IN_FILE"); duplicateInFile++; }
      else seen.add(email);
    }
    if (values.some((v) => v.length > 20_000)) errors.push("FIELD_TOO_LARGE");
    return { rowNumber: index + 2, email, valid: errors.length === 0, errors };
  });
  return {
    headers,
    rows,
    totals: { total: rows.length, valid: rows.filter((x) => x.valid).length, invalid: rows.filter((x) => !x.valid).length, duplicateInFile },
  };
}
