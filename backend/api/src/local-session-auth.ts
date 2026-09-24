import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { PrismaClient } from "@prisma/client";

const LOCAL_SESSION_COOKIE = "email_platform_session";

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function cookieValue(req: IncomingMessage, name: string) {
  const item = String(req.headers.cookie ?? "")
    .split(";")
    .map((value) => value.trim())
    .find((value) => value.startsWith(`${name}=`));
  return item ? decodeURIComponent(item.slice(name.length + 1)) : null;
}

/**
 * Resolves an authenticated local-password session. It is intentionally
 * disabled in production and never replaces OIDC authentication there.
 */
export async function localSessionActor(
  prisma: PrismaClient,
  req: IncomingMessage,
): Promise<{ userId: string; email: string } | null> {
  if (process.env.NODE_ENV === "production" || process.env.EMAIL_PLATFORM_LOCAL_PASSWORD_AUTH_ENABLED !== "true") {
    return null;
  }

  const token = cookieValue(req, LOCAL_SESSION_COOKIE);
  if (!token) return null;

  const session = await prisma.localSession.findFirst({
    where: { tokenHash: tokenHash(token), revokedAt: null, expiresAt: { gt: new Date() } },
    select: { userId: true },
  });
  if (!session) return null;

  const user = await prisma.userIdentity.findUnique({
    where: { id: session.userId },
    select: { id: true, email: true, status: true },
  });
  return user?.status === "active" ? { userId: user.id, email: user.email } : null;
}
