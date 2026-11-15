import {
  buildMerchantSessionCookie,
  isLoginRateLimited,
  isMerchantAuthConfigured,
  issueMerchantSession,
  resetLoginRateLimit,
  shouldUseSecureCookie,
  verifyMerchantPassword,
} from "@/lib/ask/merchant-auth";
import { isSameOriginRequest } from "@/lib/ask/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 4 * 1024;

function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
}

export async function POST(request: Request): Promise<Response> {
  if (!isMerchantAuthConfigured()) {
    console.error("[merchant-auth] login_unavailable", { reason: "missing_configuration" });
    return json({ error: "Merchant sign-in is not configured." }, 503);
  }
  if (!isSameOriginRequest(request)) {
    return json({ error: "Request origin is not allowed." }, 403);
  }
  if (isLoginRateLimited(request)) {
    return json({ error: "Too many attempts. Please wait a few minutes and try again." }, 429);
  }
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    return json({ error: "Send the password as JSON." }, 415);
  }

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_BODY_BYTES) return json({ error: "The request is too large." }, 413);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "The request could not be read." }, 400);
  }

  const password = body && typeof body === "object" && !Array.isArray(body)
    ? (body as { password?: unknown }).password
    : undefined;
  if (typeof password !== "string" || !password) {
    return json({ error: "Enter the merchant password." }, 400);
  }

  if (!verifyMerchantPassword(password)) {
    console.warn("[merchant-auth] login_rejected", { reason: "invalid_password" });
    return json({ error: "That password is not correct." }, 401);
  }

  resetLoginRateLimit(request);
  const { token, expiresAt } = issueMerchantSession();
  console.info("[merchant-auth] login_succeeded", { expires_at: new Date(expiresAt).toISOString() });

  return json(
    { ok: true, expiresAt },
    200,
    { "Set-Cookie": buildMerchantSessionCookie(token, shouldUseSecureCookie(request)) },
  );
}
