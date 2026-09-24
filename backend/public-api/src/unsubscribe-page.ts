function esc(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function renderUnsubscribeConfirmPage(token: string): string {
  const safeToken = esc(token);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Unsubscribe</title><style>
body{margin:0;font-family:Arial,sans-serif;background:#f6f8fa;color:#1d2227}
main{max-width:480px;margin:10vh auto;padding:32px 28px;background:#fff;border:1px solid #e2e6ea;border-radius:16px;box-shadow:0 10px 30px #18222b0d}
h1{margin:0 0 10px;font-size:24px}
p{margin:0 0 18px;line-height:1.5;color:#5d6670}
button{min-height:42px;padding:0 18px;border:0;border-radius:10px;background:#191b1e;color:#fff;font-size:14px;font-weight:700;cursor:pointer}
button:hover{background:#000}
</style></head><body><main><h1>Unsubscribe</h1><p>Confirm that you no longer want marketing email from this sender.</p><form method="post" action="/unsubscribe/${safeToken}"><input type="hidden" name="token" value="${safeToken}"><button type="submit">Unsubscribe</button></form></main></body></html>`;
}

export function renderUnsubscribeSuccessPage(brandName: string): string {
  const safeBrand = esc(brandName);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Unsubscribed</title><style>
body{margin:0;font-family:Arial,sans-serif;background:#f6f8fa;color:#1d2227}
main{max-width:480px;margin:10vh auto;padding:32px 28px;background:#fff;border:1px solid #e2e6ea;border-radius:16px;box-shadow:0 10px 30px #18222b0d}
h1{margin:0 0 10px;font-size:24px}
p{margin:0;line-height:1.55;color:#5d6670}
</style></head><body><main><h1>You have been unsubscribed.</h1><p>You will no longer receive marketing emails from <strong>${safeBrand}</strong>.</p></main></body></html>`;
}

export function renderUnsubscribeErrorPage(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex,nofollow"><title>Unsubscribe</title><style>body{margin:0;font-family:Arial,sans-serif;background:#f6f8fa;color:#1d2227}main{max-width:480px;margin:10vh auto;padding:32px 28px;background:#fff;border:1px solid #e2e6ea;border-radius:16px}h1{margin:0 0 10px;font-size:24px}p{margin:0;color:#5d6670;line-height:1.5}</style></head><body><main><h1>Unable to unsubscribe</h1><p>This unsubscribe link is invalid or has expired. If you still receive unwanted email, contact the sender directly.</p></main></body></html>`;
}

export async function readUnsubscribeToken(req: import("node:http").IncomingMessage, url: URL, readBody: () => Promise<string>): Promise<string> {
  const pathMatch = url.pathname.match(/\/(?:public\/v1\/)?unsubscribe\/([^/?#]+)/);
  if (pathMatch?.[1]) return decodeURIComponent(pathMatch[1]);
  const query = url.searchParams.get("token") ?? "";
  if (query) return query;
  if (req.method !== "POST") return "";
  const raw = await readBody();
  return new URLSearchParams(raw).get("token") ?? "";
}

export function isUnsubscribePath(pathname: string): boolean {
  return pathname === "/public/v1/unsubscribe" || pathname.startsWith("/public/v1/unsubscribe/")
    || pathname === "/unsubscribe" || pathname.startsWith("/unsubscribe/");
}
