import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { resolvePublicationStatus } from "../lib/inventory/publication-status.mjs";

const expectedProjectId = "cnewytssajkrtrenvlgz";
const bucketName = "product-images";
const maxImageBytes = 5 * 1024 * 1024;
const allowedMimeTypes = new Map([
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
  [".avif", "image/avif"],
]);
const familyCodes = new Map([
  ["makhana", "01"],
  ["cashew", "02"],
  ["almond", "03"],
  ["raisin", "04"],
  ["walnut", "05"],
]);
const skuPattern = /^([1-5])([A-C])$/;
const args = process.argv.slice(2);
const isApply = args.includes("--apply");
const { loadEnvConfig } = nextEnv;

if (isApply && args.includes("--dry-run")) {
  throw new Error("Choose either --dry-run or --apply, not both.");
}

if (args.some((argument) => !["--apply", "--dry-run"].includes(argument))) {
  throw new Error("Usage: node scripts/import-shahi-meva-inventory.mjs [--dry-run | --apply]");
}

loadEnvConfig(process.cwd());

const sourceRoot = path.resolve(process.env.SHAHI_MEVA_SOURCE_DIR || path.resolve(process.cwd(), "../shahi_meva"));
const assetsRoot = path.join(sourceRoot, "assets");
const dataPath = path.join(sourceRoot, "inventory-data.js");
const report = {
  mode: isApply ? "apply" : "dry-run",
  project_id: expectedProjectId,
  source_records: 0,
  families: { source: 0, to_create: 0, created: 0, already_present: 0, conflicts: [] },
  products: { source: 0, to_import: 0, inserted: 0, already_present: [], conflicts: [], invalid: [] },
  images: {
    unique_referenced: 0,
    to_upload: 0,
    uploaded: 0,
    already_present: 0,
    manifest: [],
    missing: [],
    oversized: [],
    unsupported: [],
  },
  sku_mapping: [],
  warnings: [
    "The source has a numeric weight field but the approved schema has no numeric weight column; the value is preserved alongside the pack label in products.variant.",
    "The source category key is represented by its family-code mapping; family_name preserves both categoryName and categoryEnglish.",
  ],
};

function mapSku(legacySku) {
  const match = skuPattern.exec(legacySku);
  if (!match) return null;
  return `${match[1].padStart(2, "0")}${match[2]}`;
}

function getSourceInventory(sourceText) {
  const match = sourceText.match(
    /^\s*window\.shahiMevaInventoryData\s*=\s*(\[[\s\S]*\])\s*;?\s*$/,
  );
  if (!match) {
    throw new Error("Could not locate the inventory data array in inventory-data.js.");
  }

  return vm.runInNewContext(`(${match[1]})`, Object.create(null), { timeout: 1000 });
}

function toAssetRelativePath(sourcePath) {
  if (typeof sourcePath !== "string" || !sourcePath.startsWith("assets/")) return null;
  const resolved = path.resolve(sourceRoot, sourcePath);
  if (!resolved.startsWith(`${assetsRoot}${path.sep}`)) return null;
  return sourcePath.replaceAll("\\", "/");
}

async function inspectImage(relativePath) {
  const mimeType = allowedMimeTypes.get(path.extname(relativePath).toLowerCase());
  if (!mimeType) {
    return { status: "unsupported", path: relativePath, reason: "Unsupported image format." };
  }

  const absolutePath = path.resolve(sourceRoot, relativePath);
  try {
    const fileStats = await stat(absolutePath);
    if (!fileStats.isFile()) {
      return { status: "missing", path: relativePath, reason: "Source path is not a file." };
    }
    if (fileStats.size > maxImageBytes) {
      return { status: "oversized", path: relativePath, size_bytes: fileStats.size };
    }
    return { status: "ready", path: relativePath, size_bytes: fileStats.size, mime_type: mimeType };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { status: "missing", path: relativePath, reason: "Source image file does not exist." };
    }
    throw error;
  }
}

function failIfSupabaseError(error, operation) {
  if (error) {
    throw new Error(`${operation} failed${error.code ? ` (${error.code})` : ""}.`);
  }
}

const sourceText = await readFile(dataPath, "utf8");
const sourceProducts = getSourceInventory(sourceText);
if (!Array.isArray(sourceProducts)) throw new Error("Inventory source must be an array.");
report.source_records = sourceProducts.length;
report.products.source = sourceProducts.length;

const familyByCode = new Map();
const imagePaths = new Set();
const productRecords = [];
const sourceSkus = new Set();

for (const sourceProduct of sourceProducts) {
  const newSku = mapSku(sourceProduct.sku);
  const familyCode = familyCodes.get(sourceProduct.category);
  const publicationStatus = resolvePublicationStatus(sourceProduct);
  if (
    !newSku ||
    !familyCode ||
    sourceSkus.has(sourceProduct.sku) ||
    typeof sourceProduct.categoryName !== "string" ||
    typeof sourceProduct.categoryEnglish !== "string" ||
    typeof sourceProduct.name !== "string" ||
    typeof sourceProduct.description !== "string" ||
    typeof sourceProduct.pack !== "string" ||
    !Number.isFinite(sourceProduct.weight) ||
    !Number.isFinite(sourceProduct.price) ||
    typeof sourceProduct.inStock !== "boolean" ||
    publicationStatus === null
  ) {
    report.products.invalid.push({
      legacy_sku: sourceProduct.sku ?? null,
      reason: "Missing, duplicate, or invalid source field.",
    });
    continue;
  }
  sourceSkus.add(sourceProduct.sku);

  const familyName = `${sourceProduct.categoryName} (${sourceProduct.categoryEnglish})`;
  const existingFamily = familyByCode.get(familyCode);
  if (existingFamily && existingFamily !== familyName) {
    report.families.conflicts.push({ family_code: familyCode, reason: "Inconsistent source family names." });
  } else {
    familyByCode.set(familyCode, familyName);
  }

  const sourceImages = Array.isArray(sourceProduct.images) ? sourceProduct.images : [];
  const imageRefs = [...new Set([sourceProduct.image, ...sourceImages].filter(Boolean))].slice(0, 2);
  if (imageRefs.length === 0 || !sourceProduct.image) {
    report.products.invalid.push({
      legacy_sku: sourceProduct.sku,
      reason: "Product has no main image reference.",
    });
  }

  const normalizedImages = imageRefs.map(toAssetRelativePath);
  if (normalizedImages.some((imagePath) => !imagePath)) {
    report.products.invalid.push({
      legacy_sku: sourceProduct.sku,
      reason: "Image path is not within the source assets directory.",
    });
  }

  for (const imagePath of normalizedImages.filter(Boolean)) imagePaths.add(imagePath);
  report.sku_mapping.push({ legacy_sku: sourceProduct.sku, sku: newSku });
  productRecords.push({
    legacySku: sourceProduct.sku,
    sku: newSku,
    familyCode,
    familyName,
    productName: sourceProduct.name,
    description: sourceProduct.description,
    variant: `${sourceProduct.pack} (${sourceProduct.weight} kg)`,
    price: sourceProduct.price,
    availability: sourceProduct.inStock ? "in_stock" : "out_of_stock",
    publicationStatus,
    imagePaths: normalizedImages.filter(Boolean),
  });
}

report.families.source = familyByCode.size;

const imageChecks = await Promise.all([...imagePaths].map(inspectImage));
const imagesByPath = new Map(imageChecks.map((image) => [image.path, image]));
report.images.unique_referenced = imageChecks.length;
report.images.manifest = imageChecks.map(({ path: imagePath, size_bytes, mime_type, status }) => ({
  source_path: imagePath,
  storage_path: `initial-import/${imagePath}`,
  size_bytes: size_bytes ?? null,
  mime_type: mime_type ?? null,
  status,
}));
report.images.missing = imageChecks.filter((image) => image.status === "missing");
report.images.oversized = imageChecks.filter((image) => image.status === "oversized");
report.images.unsupported = imageChecks.filter((image) => image.status === "unsupported");

const invalidImagePaths = new Set([
  ...report.images.missing,
  ...report.images.oversized,
  ...report.images.unsupported,
].map((image) => image.path));
const validRecords = productRecords.filter((product) => {
  const invalid = product.imagePaths.some((imagePath) => invalidImagePaths.has(imagePath));
  if (invalid) {
    report.products.invalid.push({
      legacy_sku: product.legacySku,
      sku: product.sku,
      reason: "One or more product images cannot be imported.",
    });
  }
  return !invalid;
});

for (const product of validRecords) {
  for (const imagePath of product.imagePaths) {
    const image = imagesByPath.get(imagePath);
    if (image && image.size_bytes > maxImageBytes) {
      throw new Error("Image validation inconsistency.");
    }
  }
}

const supabaseUrl = process.env.SHAHI_MEVA_SUPABASE_URL;
const secretKey = process.env.SHAHI_MEVA_SUPABASE_SECRET_KEY;
if (!supabaseUrl || !secretKey) {
  throw new Error("SHAHI_MEVA_SUPABASE_URL and SHAHI_MEVA_SUPABASE_SECRET_KEY are required.");
}

let projectHostname;
try {
  projectHostname = new URL(supabaseUrl).hostname;
} catch {
  throw new Error("SHAHI_MEVA_SUPABASE_URL is invalid.");
}
if (projectHostname !== `${expectedProjectId}.supabase.co`) {
  throw new Error("The configured Supabase URL does not match the expected project.");
}

const supabase = createClient(supabaseUrl, secretKey, {
  auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
});
const targetFamilyCodes = [...familyByCode.keys()];
const targetSkus = validRecords.map((product) => product.sku);

const [familyResponse, productResponse, bucketResponse] = await Promise.all([
  supabase
    .from("product_families")
    .select("id,family_code,family_name,archived_at")
    .in("family_code", targetFamilyCodes),
  supabase.from("products").select("sku").in("sku", targetSkus),
  supabase.storage.getBucket(bucketName),
]);

failIfSupabaseError(familyResponse.error, "Family preflight query");
failIfSupabaseError(productResponse.error, "Product preflight query");
failIfSupabaseError(bucketResponse.error, "Storage bucket preflight");

const existingFamilies = new Map(familyResponse.data.map((family) => [family.family_code, family]));
const familyIds = new Map();
const familiesToCreate = [];
const blockedFamilyCodes = new Set();

for (const [familyCode, familyName] of familyByCode) {
  const existing = existingFamilies.get(familyCode);
  if (!existing) {
    familiesToCreate.push({ family_code: familyCode, family_name: familyName });
  } else if (existing.family_name !== familyName || existing.archived_at !== null) {
    blockedFamilyCodes.add(familyCode);
    report.families.conflicts.push({
      family_code: familyCode,
      reason: existing.archived_at !== null ? "Family code is archived and cannot be reused." : "Family code belongs to a different family name.",
    });
  } else {
    familyIds.set(familyCode, existing.id);
  }
}

report.families.to_create = familiesToCreate.filter((family) => !blockedFamilyCodes.has(family.family_code)).length;
report.families.already_present = familyIds.size;

const existingSkus = new Set(productResponse.data.map((product) => product.sku));
const productsToImport = [];
for (const product of validRecords) {
  if (blockedFamilyCodes.has(product.familyCode)) {
    report.products.conflicts.push({ sku: product.sku, reason: "Product family code is occupied by a conflicting or archived family." });
  } else if (existingSkus.has(product.sku)) {
    report.products.already_present.push(product.sku);
  } else {
    productsToImport.push(product);
  }
}
report.products.to_import = productsToImport.length;

const imagesNeeded = new Set(productsToImport.flatMap((product) => product.imagePaths));
report.images.to_upload = [...imagesNeeded].filter((imagePath) => imagesByPath.get(imagePath)?.status === "ready").length;

if (isApply && (
  report.products.invalid.length > 0 ||
  report.images.missing.length > 0 ||
  report.images.oversized.length > 0 ||
  report.images.unsupported.length > 0 ||
  report.families.conflicts.length > 0
)) {
  console.log(JSON.stringify(report, null, 2));
  throw new Error("Import stopped because preflight reported invalid source data or conflicts.");
}

if (isApply) {
  const storage = supabase.storage.from(bucketName);
  const storagePaths = new Map();
  for (const imagePath of imagesNeeded) {
    const image = imagesByPath.get(imagePath);
    const storagePath = `initial-import/${imagePath}`;
    const file = await readFile(path.resolve(sourceRoot, imagePath));
    const { error } = await storage.upload(storagePath, file, {
      contentType: image.mime_type,
      upsert: false,
    });
    if (error) {
      const { data: existingObject, error: existingObjectError } = await storage.download(storagePath);
      if (existingObjectError || !existingObject) {
        throw new Error(`Image upload failed for ${imagePath}${error.statusCode ? ` (${error.statusCode})` : ""}.`);
      }
      report.images.already_present += 1;
    } else {
      report.images.uploaded += 1;
    }
    storagePaths.set(imagePath, storagePath);
  }

  for (const family of familiesToCreate) {
    if (blockedFamilyCodes.has(family.family_code)) continue;
    const { data, error } = await supabase
      .from("product_families")
      .insert(family)
      .select("id,family_code,family_name,archived_at")
      .single();
    if (error) {
      const { data: concurrentFamily, error: lookupError } = await supabase
        .from("product_families")
        .select("id,family_code,family_name,archived_at")
        .eq("family_code", family.family_code)
        .maybeSingle();
      if (lookupError || !concurrentFamily || concurrentFamily.family_name !== family.family_name || concurrentFamily.archived_at !== null) {
        throw new Error(`Family creation failed for code ${family.family_code}${error.code ? ` (${error.code})` : ""}.`);
      }
      familyIds.set(family.family_code, concurrentFamily.id);
    } else {
      familyIds.set(family.family_code, data.id);
      report.families.created += 1;
    }
  }

  for (const product of productsToImport) {
    const image_1 = product.imagePaths[0] ? storagePaths.get(product.imagePaths[0]) : null;
    const image_2 = product.imagePaths[1] ? storagePaths.get(product.imagePaths[1]) : null;
    const row = {
      sku: product.sku,
      image_1: image_1 ?? null,
      image_2: image_2 ?? null,
      product_name: product.productName,
      description: product.description,
      variant: product.variant,
      price: product.price,
      family_id: familyIds.get(product.familyCode),
      publication_status: product.publicationStatus,
      availability: product.availability,
    };
    const { error } = await supabase.from("products").insert(row);
    if (error) {
      const { data: existingProduct, error: lookupError } = await supabase
        .from("products")
        .select("sku")
        .eq("sku", product.sku)
        .maybeSingle();
      if (lookupError || !existingProduct) {
        throw new Error(`Product insert failed for SKU ${product.sku}${error.code ? ` (${error.code})` : ""}.`);
      }
      report.products.already_present.push(product.sku);
      continue;
    }
    report.products.inserted += 1;
  }
}

console.log(JSON.stringify(report, null, 2));
