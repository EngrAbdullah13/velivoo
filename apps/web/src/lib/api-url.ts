/**
 * Browser requests use the Next.js origin so the deployed app can keep its
 * frontend and API behind one Heroku web dyno. Next rewrites /api/* to the
 * private API gateway. Server-side requests go directly to that gateway.
 */
export function apiBaseUrl(): string {
  if (typeof window !== "undefined") return "";

  return (
    process.env.EMAIL_PLATFORM_INTERNAL_API_URL ??
    process.env.NEXT_PUBLIC_EMAIL_PLATFORM_API_URL ??
    (process.env.NODE_ENV === "production" ? "http://127.0.0.1:4100" : "http://localhost:4000")
  );
}
