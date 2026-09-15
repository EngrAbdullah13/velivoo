export type PropertyType = "text" | "number" | "boolean" | "datetime" | "text_array";

export function normalizeEmail(input: string): string {
  const trimmed = input.trim();
  const at = trimmed.lastIndexOf("@");
  if (at <= 0 || at === trimmed.length - 1) throw new Error("INVALID_EMAIL");
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1).toLowerCase();
  if (!local || !domain.includes(".")) throw new Error("INVALID_EMAIL");
  return `${local}@${domain}`;
}

export function validatePropertyValue(type: PropertyType, value: unknown): boolean {
  if (value === null || value === undefined) return false;
  switch (type) {
    case "text": return typeof value === "string";
    case "number": return typeof value === "number" && Number.isFinite(value);
    case "boolean": return typeof value === "boolean";
    case "datetime": return typeof value === "string" && !Number.isNaN(Date.parse(value));
    case "text_array": return Array.isArray(value) && value.every((v) => typeof v === "string");
  }
}

export function neutralizeSpreadsheetFormula(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}
