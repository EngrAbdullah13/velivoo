export interface CursorPage<T> { items: T[]; nextCursor: string | null; }

export function encodeCursor(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

export function decodeCursor(cursor?: string | null): string | null {
  if (!cursor) return null;
  try { return Buffer.from(cursor, "base64url").toString("utf8"); }
  catch { throw new Error("INVALID_CURSOR"); }
}

export function paginateById<T extends { id: string }>(items: T[], limit = 50, cursor?: string | null): CursorPage<T> {
  const safeLimit = Math.max(1, Math.min(200, Math.trunc(limit)));
  const after = decodeCursor(cursor);
  const sorted = [...items].sort((a,b)=>a.id.localeCompare(b.id));
  const start = after ? Math.max(0, sorted.findIndex((x)=>x.id===after)+1) : 0;
  const page = sorted.slice(start, start + safeLimit);
  const hasMore = start + safeLimit < sorted.length;
  return { items: page, nextCursor: hasMore && page.length ? encodeCursor(page.at(-1)!.id) : null };
}
