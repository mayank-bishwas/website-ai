import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export const MERCHANT_SESSION_COOKIE = "iso_merchant_session";
export const MERCHANT_SESSION_MAX_AGE_SECONDS = 60 * 60 * 8;

const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 5 * 60 * 1000;

type RateEntry = { count: number; startedAt: number };
const loginAttempts = new Map<string, RateEntry>();

function sessionSecret(): string | null {
  const secret = process.env.SHAHI_MEVA_SESSION_SECRET;
  return secret && secret.length >= 16 ? secret : null;
}

function merchantPassword(): string | null {
  const password = process.env.SHAHI_MEVA_MERCHANT_PASSWORD;
  return password && password.length > 0 ? password : null;
}

export function isMerchantAuthConfigured(): boolean {
  return sessionSecret() !== null && merchantPassword() !== null;
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** Constant-time comparison of a submitted password against the configured merchant password. */
export function verifyMerchantPassword(submitted: string): boolean {
  const expected = merchantPassword();
  if (!expected) return false;
  return safeEqual(submitted, expected);
}

/** Issue a fresh signed session token: `<sessionId>.<expiresAtMs>.<signature>`. */
export function issueMerchantSession(now = Date.now()): { token: string; expiresAt: number } {
  const secret = sessionSecret();
  if (!secret) throw new Error("Merchant session secret is not configured.");
  const expiresAt = now + MERCHANT_SESSION_MAX_AGE_SECONDS * 1000;
  const payload = `${randomUUID()}.${expiresAt}`;
  return { token: `${payload}.${sign(payload, secret)}`, expiresAt };
}

/** Verify signature and expiry of a session token. */
export function verifyMerchantSession(token: string | null | undefined, now = Date.now()): boolean {
  const secret = sessionSecret();
  if (!secret || !token) return false;

  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [sessionId, expiresAtRaw, signature] = parts;
  if (!sessionId || !expiresAtRaw || !signature) return false;

  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return false;

  return safeEqual(signature, sign(`${sessionId}.${expiresAtRaw}`, secret));
}

export function readMerchantSessionCookie(request: Request): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === MERCHANT_SESSION_COOKIE) return decodeURIComponent(rest.join("="));
  }
  return null;
}

/** True when the request carries a valid, unexpired merchant session cookie. */
export function isMerchantAuthenticated(request: Request): boolean {
  return verifyMerchantSession(readMerchantSessionCookie(request));
}

export function buildMerchantSessionCookie(token: string, secure: boolean): string {
  const attributes = [
    `${MERCHANT_SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${MERCHANT_SESSION_MAX_AGE_SECONDS}`,
  ];
  if (secure) attributes.push("Secure");
  return attributes.join("; ");
}

export function buildClearedMerchantSessionCookie(secure: boolean): string {
  const attributes = [
    `${MERCHANT_SESSION_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (secure) attributes.push("Secure");
  return attributes.join("; ");
}

/** Cookies must be Secure whenever the request itself arrived over HTTPS. */
export function shouldUseSecureCookie(request: Request): boolean {
  try {
    if (new URL(request.url).protocol === "https:") return true;
  } catch {
    // fall through to header inspection
  }
  return (request.headers.get("x-forwarded-proto") ?? "").toLowerCase() === "https";
}

function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}

/** Bounded per-client login attempt limiter. Returns true when the caller is over the limit. */
export function isLoginRateLimited(request: Request, now = Date.now()): boolean {
  const key = clientKey(request);
  const entry = loginAttempts.get(key);
  if (!entry || now - entry.startedAt >= LOGIN_WINDOW_MS) {
    loginAttempts.set(key, { count: 1, startedAt: now });
    return false;
  }
  entry.count += 1;
  return entry.count > LOGIN_MAX_ATTEMPTS;
}

export function resetLoginRateLimit(request: Request): void {
  loginAttempts.delete(clientKey(request));
}
