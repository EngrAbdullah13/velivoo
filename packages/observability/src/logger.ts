export function log(event: string, fields: Record<string, unknown> = {}): void {
  const redacted = { ...fields };
  for (const key of Object.keys(redacted)) {
    if (/email|token|secret|body|html|consent/i.test(key)) redacted[key] = "[redacted]";
  }
  process.stdout.write(JSON.stringify({ ts: new Date().toISOString(), event, ...redacted }) + "\n");
}
