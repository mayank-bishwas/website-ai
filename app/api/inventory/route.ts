import { randomUUID } from "node:crypto";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isAllowedLocalAskOrigin, isAskLocalAccessAllowed } from "@/lib/ask/access";
import type { InventoryProduct } from "@/lib/inventory/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUCKET = "product-images";
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_REQUEST_BYTES = 10 * 1024 * 1024 + 64 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);
const ALLOWED_CURRENCIES = new Set(["INR", "USD", "EUR", "AED", "GBP", "CAD", "AUD"]);
const ALLOWED_UNITS = new Set(["g", "kg", "ml", "l", "box", "packet", "piece", "NA"]);
const ALLOWED_AVAILABILITY = new Set(["in_stock", "out_of_stock"]);

type ProductRow = {
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
  publication_status: "draft" | "published";
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  product_families: { id: string; family_code: string; family_name: string } | { id: string; family_code: string; family_name: string }[] | null;
};

type ProductInput = {
  familyId?: unknown;
  familyName?: unknown;
  name?: unknown;
  description?: unknown;
  variant?: unknown;
  unit?: unknown;
  price?: unknown;
  currency?: unknown;
  availability?: unknown;
  imagePaths?: unknown;
};

type ParsedInput = {
  familyId?: string;
  familyName: string;
  name: string;
  description: string;
  variant: string;
  unit: string | null;
  price: number;
  currency: string | null;
  availability: "in_stock" | "out_of_stock";
  imagePaths: [string | null, string | null];
};

type ImageFile = {
  file: File;
  slot: 0 | 1;
};

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

function isLocalDevelopmentRequest(request: Request): boolean {
  try {
    return isAskLocalAccessAllowed({
      nodeEnv: process.env.NODE_ENV,
      vercel: process.env.VERCEL,
      hostname: new URL(request.url).hostname,
    });
  } catch {
    return false;
  }
}

function hasSameOrigin(request: Request): boolean {
  return isAllowedLocalAskOrigin({
    origin: request.headers.get("origin"),
    requestUrl: request.url,
    hostHeader: request.headers.get("host"),
  });
}

function requireLocalRequest(request: Request): Response | null {
  if (!isLocalDevelopmentRequest(request)) {
    return json({ error: "Inventory editing is available only in local development." }, 404);
  }
  if (!hasSameOrigin(request)) return json({ error: "The request origin is not allowed." }, 403);
  return null;
}

function asObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseProductInput(value: unknown, creating: boolean): ParsedInput | string {
  if (!asObject(value)) return "The product details could not be read.";
  const input = value as ProductInput;
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const description = typeof input.description === "string" ? input.description.trim() : "";
  const variant = typeof input.variant === "number" ? String(input.variant) : typeof input.variant === "string" ? input.variant.trim() : "";
  const unit = input.unit === null || input.unit === "" ? null : typeof input.unit === "string" ? input.unit.trim() : undefined;
  const currency = input.currency === null || input.currency === "" ? null : typeof input.currency === "string" ? input.currency : undefined;
  const price = typeof input.price === "number" ? input.price : Number.NaN;
  const availability = input.availability;
  const familyId = typeof input.familyId === "string" ? input.familyId : undefined;
  const familyName = typeof input.familyName === "string" ? input.familyName.trim() : name;

  if (!name || name.length > 300) return "Enter a product name.";
  const numericVariant = Number(variant);
    if (unit !== "NA") {
      if (!variant || !Number.isFinite(numericVariant) || numericVariant <= 0 || !/^\d+(?:\.\d+)?$/.test(variant)) {
        return "Enter a valid numeric variant value.";
      }
    } else if (variant) {
      if (!Number.isFinite(numericVariant) || numericVariant <= 0 || !/^\d+(?:\.\d+)?$/.test(variant)) {
        return "Enter a valid numeric variant value.";
      }
    }
    if (description.length > 10_000) return "The description is too long.";
    if (unit === undefined || (unit !== null && !ALLOWED_UNITS.has(unit))) return "Choose a valid variant unit.";
    if (creating && unit === null) return "Choose a variant unit for the new product.";
    if (currency === undefined || (currency !== null && !ALLOWED_CURRENCIES.has(currency))) return "Choose a valid currency.";
    if (creating && currency === null) return "Choose a currency for the new product.";
    const scaledPrice = price * 100;
    if (!Number.isFinite(price) || price <= 0 || price > 9_999_999_999.99 || Math.abs(scaledPrice - Math.round(scaledPrice)) > 1e-8) {
      return "Enter a valid price with no more than two decimal places.";
    }
    if (typeof availability !== "string" || !ALLOWED_AVAILABILITY.has(availability)) return "Choose a valid availability.";
    if (creating && (!familyName || familyName.length > 300)) return "Enter a valid product family name.";
    if (familyId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(familyId)) {
      return "Choose a valid product family.";
    }

    let imagePaths: [string | null, string | null] = [null, null];
    if (!creating && Array.isArray(input.imagePaths) && input.imagePaths.length === 2) {
      const [first, second] = input.imagePaths;
      if ((first !== null && typeof first !== "string") || (second !== null && typeof second !== "string")) {
        return "The product images could not be read.";
      }
      imagePaths = [first, second];
    } else if (!creating) {
      return "The product images could not be read.";
    }

    return {
      familyId,
      familyName,
      name,
      description,
      variant,
      unit,
      price,
      currency,
      availability: availability as ParsedInput["availability"],
      imagePaths,
    };
  }

  async function parseMultipart(request: Request): Promise<{ product: unknown; files: ImageFile[] } | null> {
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > MAX_REQUEST_BYTES) return null;
    const form = await request.formData();
    const productValue = form.get("product");
    if (typeof productValue !== "string") return null;

    let product: unknown;
    try {
      product = JSON.parse(productValue);
    } catch {
      return null;
    }

    const files: ImageFile[] = [];
    for (const [slot, key] of ["image_1", "image_2"].entries()) {
      const value = form.get(key);
      if (value === null || typeof value === "string") continue;
      if (value.size === 0) continue;
      if (value.size > MAX_IMAGE_BYTES || !ALLOWED_IMAGE_TYPES.has(value.type)) {
        throw new Error(value.size > MAX_IMAGE_BYTES ? "Each image must be 5 MB or smaller." : "Use a JPEG, PNG, WebP or AVIF image.");
      }
      files.push({ file: value, slot: slot as 0 | 1 });
    }
    return { product, files };
  }

  function familyOf(row: ProductRow) {
    return Array.isArray(row.product_families) ? row.product_families[0] ?? null : row.product_families;
  }

  function displayDate(value: string): { date: string; time: string } {
    const date = new Date(value);
    return {
      date: new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(date),
      time: new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" }).format(date),
    };
  }

  async function fetchProducts(): Promise<{ products: InventoryProduct[]; families: { id: string; familyCode: string; familyName: string }[] }> {
    const supabase = createSupabaseServerClient();
    const [{ data: rows, error: productError, count }, { data: families, error: familyError }] = await Promise.all([
      supabase
        .from("products")
        .select("sku,family_id,product_name,description,variant,variant_unit,price,currency,availability,image_1,image_2,publication_status,created_at,updated_at,archived_at,product_families(id,family_code,family_name)", { count: "exact" })
        .order("created_at", { ascending: false })
        .limit(1000),
      supabase.from("product_families").select("id,family_code,family_name").is("archived_at", null).order("family_code"),
    ]);
    if (productError || familyError) throw new Error("Inventory could not be loaded from the database.");
    if ((count ?? 0) > 1000) throw new Error("Inventory exceeds the supported result limit.");

    const productRows = (rows ?? []) as ProductRow[];
    const imagePaths = [...new Set(productRows.flatMap((row) => [row.image_1, row.image_2].filter((path): path is string => Boolean(path))))];
    const signedUrlByPath = new Map<string, string>();
    if (imagePaths.length) {
      const { data: signedUrls, error } = await supabase.storage.from(BUCKET).createSignedUrls(imagePaths, 3600);
      if (error || !signedUrls) throw new Error("Product images could not be loaded.");
      for (const item of signedUrls) {
        if (item.path && item.signedUrl && !item.error) signedUrlByPath.set(item.path, item.signedUrl);
      }
      if (imagePaths.some((path) => !signedUrlByPath.has(path))) {
        throw new Error("One or more product images could not be loaded.");
      }
    }

    return {
      products: productRows.map((row) => {
        const family = familyOf(row);
        const updated = displayDate(row.updated_at);
        return {
          sku: row.sku,
          familyId: row.family_id,
          familyName: family?.family_name ?? "",
          updated: updated.date,
          updatedTime: updated.time,
          name: row.product_name,
          description: row.description ?? "",
          variant: row.variant_unit === "NA" && row.variant === "NA" ? "" : row.variant,
          unit: row.variant_unit ?? "",
          price: Number(row.price),
          currency: row.currency ?? "",
          stock: row.availability === "in_stock",
          imagePaths: [row.image_1, row.image_2],
          photos: [row.image_1 ? signedUrlByPath.get(row.image_1) ?? "" : "", row.image_2 ? signedUrlByPath.get(row.image_2) ?? "" : ""],
          archived: row.archived_at !== null,
          publicationStatus: row.publication_status,
        };
      }),
      families: (families ?? []).map((family) => ({
        id: family.id,
        familyCode: family.family_code,
        familyName: family.family_name,
      })),
    };
  }

  async function uploadImages(files: ImageFile[]): Promise<Map<0 | 1, string>> {
    const supabase = createSupabaseServerClient();
    const uploaded = new Map<0 | 1, string>();
    for (const { file, slot } of files) {
      const path = `inventory/${randomUUID()}`;
      const { error } = await supabase.storage.from(BUCKET).upload(path, await file.arrayBuffer(), {
        contentType: file.type,
        upsert: false,
      });
      if (error) {
        if (uploaded.size) await supabase.storage.from(BUCKET).remove([...uploaded.values()]);
        throw new Error("An image could not be uploaded.");
      }
      uploaded.set(slot, path);
    }
    return uploaded;
  }

  async function removeUploaded(paths: string[]): Promise<void> {
    if (!paths.length) return;
    const { error } = await createSupabaseServerClient().storage.from(BUCKET).remove(paths);
    if (error) console.error("[inventory] cleanup_failed", error.message);
  }

  async function createProduct(productValue: unknown, files: ImageFile[]): Promise<Response> {
    const parsed = parseProductInput(productValue, true);
    if (typeof parsed === "string") return json({ error: parsed }, 400);
    const supabase = createSupabaseServerClient();
    let familyId = parsed.familyId;
    let createdFamilyId: string | null = null;

    if (familyId) {
      const { data: family, error } = await supabase
        .from("product_families")
        .select("id,family_name,archived_at")
        .eq("id", familyId)
        .maybeSingle();
      if (error) return json({ error: "The selected product family could not be checked." }, 500);
      if (!family || family.archived_at !== null || family.family_name.trim().toLocaleLowerCase() !== parsed.familyName.toLocaleLowerCase()) {
        return json({ error: "Choose a valid active product family." }, 400);
      }
    } else {
      const { data: families, error } = await supabase
        .from("product_families")
        .select("id,family_name")
        .is("archived_at", null);
      if (error) return json({ error: "A product family could not be checked." }, 500);
      const match = (families ?? []).find((family) => family.family_name.trim().toLocaleLowerCase() === parsed.name.toLocaleLowerCase());
      if (match) {
        familyId = match.id;
      } else {
        const { data: newFamily, error: familyError } = await supabase
          .from("product_families")
          .insert({ family_name: parsed.name })
          .select("id")
          .single();
        if (familyError || !newFamily) return json({ error: "The product family could not be created." }, 500);
        familyId = newFamily.id;
        createdFamilyId = newFamily.id;
      }
    }

    const archiveUnusedFamily = async () => {
      if (!createdFamilyId) return;
      const { error } = await supabase
        .from("product_families")
        .update({ archived_at: new Date().toISOString() })
        .eq("id", createdFamilyId)
        .is("archived_at", null);
      if (error) console.error("[inventory] family_cleanup_failed", error.message);
    };

    let uploadedPaths: string[] = [];
    try {
      const uploaded = await uploadImages(files);
      uploadedPaths = [...uploaded.values()];
      const imagePaths: [string | null, string | null] = [uploaded.get(0) ?? null, uploaded.get(1) ?? null];
      const variantToSave = parsed.variant || (parsed.unit === "NA" ? "NA" : "");
      const { data: savedProduct, error } = await supabase.from("products").insert({
        family_id: familyId,
        product_name: parsed.name,
        description: parsed.description,
        variant: variantToSave,
        variant_unit: parsed.unit,
        price: parsed.price,
        currency: parsed.currency,
        availability: parsed.availability,
        image_1: imagePaths[0],
        image_2: imagePaths[1],
        publication_status: "published",
      }).select("sku").single();
      if (error || !savedProduct) {
        await removeUploaded(uploadedPaths);
        await archiveUnusedFamily();
        return json({ error: "The product could not be saved. Check the details and try again." }, 400);
      }
      return json({ ok: true, sku: savedProduct.sku }, 201);
    } catch (error) {
      await removeUploaded(uploadedPaths);
      await archiveUnusedFamily();
      console.error("[inventory] create_failed", error instanceof Error ? error.message : "unknown error");
      return json({ error: error instanceof Error ? error.message : "The product could not be saved." }, 400);
    }
  }

  async function updateProduct(sku: string, productValue: unknown, files: ImageFile[]): Promise<Response> {
    const parsed = parseProductInput(productValue, false);
    if (typeof parsed === "string") return json({ error: parsed }, 400);
    const supabase = createSupabaseServerClient();
    const { data: existing, error: lookupError } = await supabase
      .from("products")
      .select("sku,image_1,image_2")
      .eq("sku", sku)
      .maybeSingle();
    if (lookupError) return json({ error: "The selected product could not be loaded." }, 500);
    if (!existing) return json({ error: "This product no longer exists. Reload the inventory and try again." }, 404);

    const retainedPaths: [string | null, string | null] = parsed.imagePaths;
    const existingPaths = new Set([existing.image_1, existing.image_2].filter((path): path is string => Boolean(path)));
    for (const [slot] of [0, 1].entries()) {
      const file = files.find((item) => item.slot === slot);
      const path = retainedPaths[slot];
      if (!file && path !== null && !existingPaths.has(path)) {
        return json({ error: "Product images may only be retained, removed or replaced using an uploaded image." }, 400);
      }
    }
    if (retainedPaths[0] !== null && retainedPaths[0] === retainedPaths[1]) {
      return json({ error: "Product images cannot be duplicated across slots." }, 400);
    }

    let uploadedPaths: string[] = [];
    try {
      const uploaded = await uploadImages(files);
      uploadedPaths = [...uploaded.values()];
      const imagePaths: [string | null, string | null] = [
        uploaded.get(0) ?? retainedPaths[0],
        uploaded.get(1) ?? retainedPaths[1],
      ];
      const variantToSave = parsed.variant || (parsed.unit === "NA" ? "NA" : "");
      const { error } = await supabase
        .from("products")
        .update({
          product_name: parsed.name,
          description: parsed.description,
          variant: variantToSave,
          variant_unit: parsed.unit,
          price: parsed.price,
          currency: parsed.currency,
          availability: parsed.availability,
          image_1: imagePaths[0],
          image_2: imagePaths[1],
          publication_status: "published",
        })
        .eq("sku", sku);
      if (error) {
        await removeUploaded(uploadedPaths);
        return json({ error: "The product could not be saved. Check the details and try again." }, 400);
      }
      return json({ ok: true });
    } catch (error) {
      await removeUploaded(uploadedPaths);
      console.error("[inventory] update_failed", error instanceof Error ? error.message : "unknown error");
      return json({ error: error instanceof Error ? error.message : "The product could not be saved." }, 400);
    }
  }

  export async function GET(request: Request): Promise<Response> {
    const denied = requireLocalRequest(request);
    if (denied) return denied;
    try {
      return json(await fetchProducts());
    } catch (error) {
      console.error("[inventory] load_failed", error instanceof Error ? error.message : "unknown error");
      return json({ error: error instanceof Error ? error.message : "Inventory could not be loaded." }, 503);
    }
  }

  export async function POST(request: Request): Promise<Response> {
    const denied = requireLocalRequest(request);
    if (denied) return denied;
    if (!request.headers.get("content-type")?.toLowerCase().includes("multipart/form-data")) {
      return json({ error: "Send product details and images as multipart form data." }, 415);
    }
    try {
      const input = await parseMultipart(request);
      if (!input) return json({ error: "The product details could not be read." }, 400);
      return await createProduct(input.product, input.files);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "The product could not be saved." }, 400);
    }
  }

  export async function PATCH(request: Request): Promise<Response> {
    const denied = requireLocalRequest(request);
    if (denied) return denied;
    const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";

    try {
      if (contentType.includes("application/json")) {
        const value: unknown = await request.json();
        if (!asObject(value) || typeof value.sku !== "string" || !value.sku.trim()) {
          return json({ error: "Choose a valid product." }, 400);
        }
        if (value.action !== "archive" && value.action !== "restore") {
          return json({ error: "Choose a valid inventory action." }, 400);
        }
        const { data, error } = await createSupabaseServerClient()
          .from("products")
          .update({ archived_at: value.action === "archive" ? new Date().toISOString() : null })
          .eq("sku", value.sku)
          .select("sku")
          .maybeSingle();
        if (error) return json({ error: "The product status could not be updated." }, 400);
        if (!data) return json({ error: "This product no longer exists. Reload the inventory and try again." }, 404);
        return json({ ok: true });
      }

      if (!contentType.includes("multipart/form-data")) return json({ error: "The request format is not supported." }, 415);
      const input = await parseMultipart(request);
      if (!input) return json({ error: "The product details could not be read." }, 400);
      const sku = new URL(request.url).searchParams.get("sku")?.trim();
      if (!sku) return json({ error: "Choose a valid product." }, 400);
      return await updateProduct(sku, input.product, input.files);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "The product could not be saved." }, 400);
    }
  }
