import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUCKET = "product-images";
const SIGNED_URL_TTL_SECONDS = 6 * 60 * 60;
const ALLOWED_ORIGINS = new Set([
  "https://shahimeva.vercel.app",
  "https://shahimeva.in",
  "https://www.shahimeva.in",
]);

function isLocalOrigin(origin: string): boolean {
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== "http:") return false;
    const hostname = parsed.hostname.replace(/^\[|\]$/g, "");
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch {
    return false;
  }
}

function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false;
  return ALLOWED_ORIGINS.has(origin) || isLocalOrigin(origin);
}

type PublicProductRow = {
  sku: string;
  family_id: string;
  product_name: string;
  description: string | null;
  variant: string;
  variant_unit: string | null;
  price: number | string;
  currency: string | null;
  availability: "in_stock" | "out_of_stock";
  image_1: string | null;
  image_2: string | null;
};

type PublicProduct = {
  sku: string;
  name: string;
  category: string;
  description: string;
  variant: string;
  unit: string;
  price: number;
  currency: string;
  inStock: boolean;
  imageUrls: string[];
};

function corsHeaders(origin: string | null): Record<string, string> {
  if (!origin || !isAllowedOrigin(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

function json(data: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...corsHeaders(origin),
    },
  });
}

export async function OPTIONS(request: Request): Promise<Response> {
  return new Response(null, { status: 204, headers: corsHeaders(request.headers.get("origin")) });
}

export async function GET(request: Request): Promise<Response> {
  const origin = request.headers.get("origin");

  try {
    const supabase = createSupabaseServerClient();

    const { data: rows, error: productError } = await supabase
      .from("products")
      .select(
        "sku,family_id,product_name,description,variant,variant_unit,price,currency,availability,image_1,image_2",
      )
      .eq("publication_status", "published")
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .limit(1000);

    if (productError) {
      console.error("[inventory-public] product_query_failed", productError.message);
      return json({ error: "Inventory could not be loaded." }, 503, origin);
    }

    const productRows = (rows ?? []) as PublicProductRow[];
    if (!productRows.length) return json([], 200, origin);

    const familyIds = [...new Set(productRows.map((row) => row.family_id))];
    const { data: families, error: familyError } = await supabase
      .from("product_families")
      .select("id,family_name")
      .in("id", familyIds);

    if (familyError) {
      console.error("[inventory-public] family_query_failed", familyError.message);
      return json({ error: "Inventory could not be loaded." }, 503, origin);
    }

    const familyNameById = new Map((families ?? []).map((family) => [family.id, family.family_name]));

    const imagePaths = [
      ...new Set(
        productRows.flatMap((row) =>
          [row.image_1, row.image_2].filter((path): path is string => Boolean(path)),
        ),
      ),
    ];

    const signedUrlByPath = new Map<string, string>();
    if (imagePaths.length) {
      const { data: signedUrls, error: signedUrlError } = await supabase.storage
        .from(BUCKET)
        .createSignedUrls(imagePaths, SIGNED_URL_TTL_SECONDS);
      if (signedUrlError) {
        console.error("[inventory-public] signed_url_failed", signedUrlError.message);
      }
      for (const item of signedUrls ?? []) {
        if (item.path && item.signedUrl && !item.error) signedUrlByPath.set(item.path, item.signedUrl);
      }
    }

    const products: PublicProduct[] = productRows.map((row) => ({
      sku: row.sku,
      name: row.product_name,
      category: familyNameById.get(row.family_id) ?? "",
      description: row.description ?? "",
      variant: row.variant,
      unit: row.variant_unit ?? "",
      price: Number(row.price),
      currency: row.currency ?? "",
      inStock: row.availability === "in_stock",
      imageUrls: [row.image_1, row.image_2]
        .filter((path): path is string => Boolean(path))
        .map((path) => signedUrlByPath.get(path) ?? "")
        .filter((url) => url !== ""),
    }));

    return json(products, 200, origin);
  } catch (error) {
    console.error(
      "[inventory-public] unexpected_error",
      error instanceof Error ? error.message : "unknown error",
    );
    return json({ error: "Inventory could not be loaded." }, 503, origin);
  }
}