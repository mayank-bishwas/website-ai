export type ProductFamily = {
  id: string;
  familyCode: string;
  familyName: string;
};

export type VariantUnit = "g" | "kg" | "ml" | "l" | "box" | "packet" | "piece" | "NA";
export const ALLOWED_VARIANT_UNITS = [
  "g",
  "kg",
  "ml",
  "l",
  "box",
  "packet",
  "piece",
  "NA",
] as const;

export type InventoryProduct = {
  sku: string;
  familyId: string;
  familyName: string;
  updated: string;
  updatedTime?: string;
  name: string;
  description: string;
  variant: string;
  unit: string;
  price: number;
  currency: string;
  stock: boolean;
  imagePaths: [string | null, string | null];
  photos: [string, string];
  archived: boolean;
  publicationStatus: "draft" | "published";
};
