import { createCipheriv, createDecipheriv, createHash, generateKeyPairSync, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";

export function generateDkimKeyPair() {
  return generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
}

export function dkimPublicKeyTxt(publicKeyPem: string) {
  const body = publicKeyPem
    .replace(/-----BEGIN PUBLIC KEY-----/g, "")
    .replace(/-----END PUBLIC KEY-----/g, "")
    .replace(/\s+/g, "");
  return `p=${body}`;
}

export function dkimPublicKeyDnsTxt(publicKeyPem: string) {
  const body = dkimPublicKeyTxt(publicKeyPem).slice(2);
  return `v=DKIM1; k=rsa; p=${body}`;
}

/** SES BYODKIM APIs expect base64 PKCS#8 DER, not PEM text with headers. */
export function dkimPrivateKeyForSes(privateKeyPem: string) {
  const base64 = privateKeyPem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  if (!/^[a-zA-Z0-9+/]+={0,2}$/.test(base64)) throw new Error("DKIM_PRIVATE_KEY_INVALID");
  return base64;
}

export function encryptDkimPrivateKey(privateKeyPem: string, secret: string) {
  if (!secret.trim()) throw new Error("DKIM_KEY_ENCRYPTION_SECRET_MISSING");
  const key = createHash("sha256").update(secret).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(privateKeyPem, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${encrypted.toString("base64url")}`;
}

export function decryptDkimPrivateKey(payload: string, secret: string) {
  if (!secret.trim()) throw new Error("DKIM_KEY_ENCRYPTION_SECRET_MISSING");
  const [version, ivB64, tagB64, dataB64] = payload.split(":");
  if (version !== "v1" || !ivB64 || !tagB64 || !dataB64) throw new Error("DKIM_KEY_CIPHER_UNSUPPORTED");
  const key = createHash("sha256").update(secret).digest();
  const decipher = createDecipheriv(ALGO, key, Buffer.from(ivB64, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64url")), decipher.final()]).toString("utf8");
}

export function hashOwnershipToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function generateRoutingId() {
  return `d_${randomBytes(4).toString("hex")}`;
}

export function generateOwnershipToken() {
  return randomBytes(24).toString("base64url");
}

/** Returns true when serialized API/log payloads must be rejected for private key material. */
export function containsPrivateKeyMaterial(value: unknown): boolean {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return /BEGIN (?:RSA )?PRIVATE KEY|PRIVATE KEY-----|DomainSigningPrivateKey/i.test(text);
}
