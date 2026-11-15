import {
  buildClearedMerchantSessionCookie,
  isMerchantAuthenticated,
  shouldUseSecureCookie,
} from "@/lib/ask/merchant-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

export async function POST(request: Request): Promise<Response> {
  const wasAuthenticated = isMerchantAuthenticated(request);
  if (wasAuthenticated) console.info("[merchant-auth] logout", { reason: "merchant_requested" });
  return json(
    { ok: true },
    200,
    { "Set-Cookie": buildClearedMerchantSessionCookie(shouldUseSecureCookie(request)) },
  );
}
