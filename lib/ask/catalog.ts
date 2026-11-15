import type { SupabaseClient } from "@supabase/supabase-js";
import type { CatalogProduct, KnowledgeFact } from "./types";

const MAX_PUBLISHED_PRODUCTS = 500;
const MAX_KNOWLEDGE_ENTRIES = 500;
const MAX_WEBSITE_CONTENT = 50;

type RawProduct = {
  sku: string;
  product_name: string;
  description: string;
  variant: string;
  variant_unit: string | null;
  price: number | string;
  currency: string | null;
  availability: "in_stock" | "out_of_stock";
  publication_status: "draft" | "published";
  archived_at: string | null;
  product_families: { family_name: string } | { family_name: string }[] | null;
};

type RawKnowledgeEntry = {
  id: string;
  content: string;
};

type RawWebsiteContent = {
  id: string;
  source_url: string;
  content: string;
};

export function formatVariant(variant: string | null | undefined, unit: string | null | undefined): string {
  const rawVariant = (variant ?? "").trim();
  const rawUnit = (unit ?? "").trim();
  const isPlaceholder = (value: string) => value === "" || value.toUpperCase() === "NA";

  if (isPlaceholder(rawVariant)) return isPlaceholder(rawUnit) ? "" : rawUnit;
  if (isPlaceholder(rawUnit)) return rawVariant;

  const variantLower = rawVariant.toLowerCase();
  const unitLower = rawUnit.toLowerCase();
  if (variantLower === unitLower || variantLower.endsWith(` ${unitLower}`)) return rawVariant;

  return `${rawVariant} ${rawUnit}`;
}

export function mapPublishedProducts(rows: RawProduct[]): CatalogProduct[] {
  return rows
    .filter((row) => row.publication_status === "published" && row.archived_at === null)
    .map((row) => {
      const family = Array.isArray(row.product_families)
        ? row.product_families[0]
        : row.product_families;
      return {
        sku: row.sku,
        name: row.product_name,
        description: row.description,
        variant: formatVariant(row.variant, row.variant_unit),
        price: Number(row.price),
        currency: row.currency ?? "",
        availability: row.availability,
        familyName: family?.family_name ?? "",
      };
    });
}

export async function getPublishedCatalog(supabase: SupabaseClient): Promise<CatalogProduct[]> {
  const { data, error, count } = await supabase
    .from("products")
    .select(
      "sku,product_name,description,variant,variant_unit,price,currency,availability,publication_status,archived_at,product_families(family_name)",
      { count: "exact" },
    )
    .eq("publication_status", "published")
    .is("archived_at", null)
    .order("product_name", { ascending: true })
    .order("sku", { ascending: true })
    .limit(MAX_PUBLISHED_PRODUCTS);

  if (error) throw new Error("Inventory query failed.");
  if ((count ?? 0) > MAX_PUBLISHED_PRODUCTS) {
    throw new Error("Published inventory exceeds the safe response limit.");
  }

  return mapPublishedProducts((data ?? []) as unknown as RawProduct[]);
}

export async function getPublishedKnowledgeEntries(
  supabase: SupabaseClient,
): Promise<KnowledgeFact[]> {
  const { data, error } = await supabase
    .from("knowledge_entries")
    .select("id, content")
    .eq("status", "published")
    .order("created_at", { ascending: false })
    .limit(MAX_KNOWLEDGE_ENTRIES);

  if (error) throw new Error("Knowledge Base query failed.");

  const rows = data as RawKnowledgeEntry[];
  return rows.map((row) => ({
    id: Number(row.id),
    content: row.content,
  }));
}

export async function getActiveWebsiteContent(
  supabase: SupabaseClient,
): Promise<{ source_url: string; content: string }[]> {
  const { data, error } = await supabase
    .from("website_content")
    .select("source_url, content")
    .eq("status", "active")
    .order("created_at", { ascending: false });

  if (error) throw new Error("Website content query failed.");

  return data as { source_url: string; content: string }[];
}
