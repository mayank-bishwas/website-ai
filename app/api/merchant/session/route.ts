import { isMerchantAuthConfigured, isMerchantAuthenticated } from "@/lib/ask/merchant-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const authenticated = isMerchantAuthConfigured() && isMerchantAuthenticated(request);
  return Response.json(
    { authenticated },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}
