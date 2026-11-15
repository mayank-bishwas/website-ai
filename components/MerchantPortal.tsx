"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { Locale, portalText, voiceText } from "@/lib/portal-i18n";
import { countKnowledgeWords, insertKnowledgeTranscript, type KnowledgeEntry } from "@/lib/portal-knowledge";
import { formatRecordingCountdown } from "@/lib/voice/recording-state";
import { useVoiceTranscription } from "@/lib/voice/use-voice-transcription";
import { ALLOWED_VARIANT_UNITS, type InventoryProduct, type ProductFamily, type VariantUnit } from "@/lib/inventory/types";

type KB = KnowledgeEntry;
type Product = InventoryProduct;
type ProductDraft = Omit<Product, "stock"> & { stock: boolean | null; photoNames?: [string, string] };
type PendingProduct = { draft: ProductDraft; sku: string | null; loading: boolean };
type Toast = { id: number; kind: "success" | "error"; message: string; retry?: boolean };
type FieldErrors = {
  name?: string;
  variant?: string;
  unit?: string;
  price?: string;
  currency?: string;
  stock?: string;
};

type Screen = "home" | "kb" | "kb-form" | "inventory" | "product-form" | "request";
type SortDirection = "asc" | "desc";

const PAGE_SIZE = 5;

const limitWords = (text: string, limit = 200) => {
  const words = text.match(/\S+\s*/g) ?? [];
  return words.length > limit ? words.slice(0, limit).join("").trimEnd() : text;
};
const countWords = (text: string) => (text.trim() ? text.trim().split(/\s+/).length : 0);

const currencies = ["INR", "USD", "EUR", "AED", "GBP", "CAD", "AUD"];
const units: VariantUnit[] = [...ALLOWED_VARIANT_UNITS];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const allowedImageTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);
const skuCompare = (a: string, b: string) => {
  const ma = a.match(/^(\d+)([A-Z])$/);
  const mb = b.match(/^(\d+)([A-Z])$/);
  return Number(mb?.[1] ?? 0) - Number(ma?.[1] ?? 0) || (mb?.[2] ?? "").localeCompare(ma?.[2] ?? "");
};

function formatVariant(variant: string, unit: string) {
  const v = variant.trim();
  const u = unit.trim();
  if (!u || u === "NA") return "";
  if (!v || v === "NA") return "";
  if (v.toLowerCase().endsWith(u.toLowerCase())) return v;
  return `${v} ${u}`;
}

export function MerchantPortal({
  locale,
  knowledge,
  knowledgeLoading,
  knowledgeError,
  onKnowledgeChange,
  onKnowledgeRefresh,
}: {
  locale: Locale;
  knowledge: KnowledgeEntry[];
  knowledgeLoading: boolean;
  knowledgeError: string;
  onKnowledgeChange: (knowledge: KnowledgeEntry[]) => void;
  onKnowledgeRefresh: () => Promise<boolean>;
}) {
  const t = portalText[locale];
  const voiceLabels = voiceText[locale];
  const [kbOriginalContent, setKbOriginalContent] = useState("");
  const voice = useVoiceTranscription(locale);
  const [screen, setScreen] = useState<Screen>("home");
  const [products, setProducts] = useState<Product[]>([]);
  const [families, setFamilies] = useState<ProductFamily[]>([]);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [inventoryLoaded, setInventoryLoaded] = useState(false);
  const [productSaving, setProductSaving] = useState(false);
  const [archivingSku, setArchivingSku] = useState<string | null>(null);
  const [rowSavingSku, setRowSavingSku] = useState<string | null>(null);
  const [pendingNewProduct, setPendingNewProduct] = useState<PendingProduct | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const toastSequence = useRef(0);
  const [kbSearch, setKbSearch] = useState("");
  const [itemSearch, setItemSearch] = useState("");
  const [kbSort, setKbSort] = useState<"id" | "updated">("id");
  const [itemSort, setItemSort] = useState<"sku" | "updated" | "price" | "stock">("sku");
  const [kbSortDirection, setKbSortDirection] = useState<SortDirection>("desc");
  const [itemSortDirection, setItemSortDirection] = useState<SortDirection>("desc");
  const [kbPage, setKbPage] = useState(0);
  const [itemPage, setItemPage] = useState(0);
  const [kbId, setKbId] = useState<number | null>(null);
  const [kbContent, setKbContent] = useState("");
  const [kbSaving, setKbSaving] = useState(false);
  const [kbActionId, setKbActionId] = useState<string | null>(null);
  const kbContentRef = useRef("");
  const kbTextareaRef = useRef<HTMLTextAreaElement>(null);
  const kbCursorPosition = useRef(0);
  const fileInputRefs = [useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null)];
  const [productDraft, setProductDraft] = useState<ProductDraft>({
    sku: "",
    familyId: "",
    familyName: "",
    updated: "",
    name: "",
    description: "",
    variant: "",
    unit: "",
    price: 0,
    currency: "INR",
    stock: null,
    imagePaths: [null, null],
    photos: ["", ""],
    photoNames: ["", ""],
    archived: false,
    publicationStatus: "published",
  });
  const [productImageFiles, setProductImageFiles] = useState<[File | null, File | null]>([null, null]);
  const [originalProduct, setOriginalProduct] = useState<ProductDraft | null>(null);
  const [productSku, setProductSku] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [formError, setFormError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [notice, setNotice] = useState("");
  const [productNameFocused, setProductNameFocused] = useState(false);
  const [productNameLimitReached, setProductNameLimitReached] = useState(false);

  const whatsappUrl = `https://wa.me/918521567359?text=${encodeURIComponent(t.sent)}`;

  function blankProduct(): ProductDraft {
    return {
      sku: "",
      familyId: "",
      familyName: "",
      updated: "",
      name: "",
      description: "",
      variant: "",
      unit: "",
      price: 0,
      currency: "INR",
      stock: null,
      imagePaths: [null, null],
      photos: ["", ""],
      photoNames: ["", ""],
      archived: false,
      publicationStatus: "published",
    };
  }

  function showToast(kind: Toast["kind"], message: string, retry = false) {
    toastSequence.current += 1;
    setToast({ id: toastSequence.current, kind, message, retry });
  }

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 5000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  async function loadInventory(): Promise<Product[] | null> {
    setInventoryLoading(true);
    try {
      const response = await fetch("/api/inventory", { cache: "no-store", credentials: "include" });
      const result = await response.json() as { products?: Product[]; families?: ProductFamily[]; error?: string };
      if (!response.ok || !result.products || !result.families) {
        throw new Error(result.error || t.inventoryLoadError);
      }
      setProducts(result.products);
      setFamilies(result.families);
      setInventoryLoaded(true);
      setPendingNewProduct((pending) => pending?.sku && result.products?.some((item) => item.sku === pending.sku) ? null : pending);
      return result.products;
    } catch {
      showToast("error", t.inventoryLoadError, true);
      return null;
    } finally {
      setInventoryLoading(false);
    }
  }

  useEffect(() => {
    if (screen === "inventory" && !inventoryLoaded) void loadInventory();
  }, [screen, inventoryLoaded]);

  function go(next: Screen) {
    if (screen === "kb-form" && next !== "kb-form") voice.discard();
    if (screen === "product-form" && next !== "product-form") {
      productDraft.photos.forEach((photo) => {
        if (photo.startsWith("blob:")) URL.revokeObjectURL(photo);
      });
    }
    setScreen(next);
    setNotice("");
    setFormError("");
  }

  function startKB(entry?: KB) {
    voice.discard();
    setKbId(entry?.id ?? null);
    setKbContent(entry?.content ?? "");
    setKbOriginalContent(entry?.content ?? "");
    kbContentRef.current = entry?.content ?? "";
    kbCursorPosition.current = entry?.content.length ?? 0;
    go("kb-form");
  }

  const filteredKB = useMemo(
    () =>
      [...knowledge]
        .filter((entry) => !kbSearch || `${entry.id} ${entry.content}`.toLowerCase().includes(kbSearch.toLowerCase()))
        .sort((a, b) => {
          const order = kbSort === "id" ? a.id - b.id : Date.parse(a.updated) - Date.parse(b.updated);
          return kbSortDirection === "asc" ? order : -order;
        }),
    [knowledge, kbSearch, kbSort, kbSortDirection],
  );
  const filteredProducts = useMemo(
    () =>
      [...products]
        .filter((item) => !itemSearch || `${item.sku} ${item.name}`.toLowerCase().includes(itemSearch.toLowerCase()))
        .sort((a, b) => {
          const order = itemSort === "sku"
            ? skuCompare(a.sku, b.sku)
            : itemSort === "updated"
              ? Date.parse(a.updated) - Date.parse(b.updated)
              : itemSort === "price"
                ? a.price - b.price
                : Number(a.stock) - Number(b.stock);
          return itemSortDirection === "asc" ? order : -order;
        }),
    [products, itemSearch, itemSort, itemSortDirection],
  );
  const kbPageCount = Math.max(1, Math.ceil(filteredKB.length / PAGE_SIZE));
  const itemPageCount = Math.max(1, Math.ceil(filteredProducts.length / PAGE_SIZE));
  const currentKbPage = Math.min(kbPage, kbPageCount - 1);
  const currentItemPage = Math.min(itemPage, itemPageCount - 1);
  const shownKB = filteredKB.slice(currentKbPage * PAGE_SIZE, (currentKbPage + 1) * PAGE_SIZE);
  const shownProducts = filteredProducts.slice(currentItemPage * PAGE_SIZE, (currentItemPage + 1) * PAGE_SIZE);
  const dirtyProduct = !originalProduct || JSON.stringify(productDraft) !== JSON.stringify(originalProduct);

  function familyForProductName(name: string) {
    const normalizedName = name.trim().toLocaleLowerCase();
    const matchingProduct = products.find((item) => item.name.trim().toLocaleLowerCase() === normalizedName);
    if (matchingProduct) {
      const family = families.find((item) => item.id === matchingProduct.familyId);
      if (family) return family;
    }
    return families.find((item) => item.familyName.trim().toLocaleLowerCase() === normalizedName);
  }

  function sortKB(key: "id" | "updated") {
    if (kbSort === key) setKbSortDirection((direction) => direction === "asc" ? "desc" : "asc");
    else {
      setKbSort(key);
      setKbSortDirection("desc");
    }
    setKbPage(0);
  }

  function sortItems(key: "sku" | "updated" | "price" | "stock") {
    if (itemSort === key) setItemSortDirection((direction) => direction === "asc" ? "desc" : "asc");
    else {
      setItemSort(key);
      setItemSortDirection("desc");
    }
    setItemPage(0);
  }

  async function saveKB() {
    if (!kbContent.trim()) {
      setFormError(t.knowledgeRequired);
      return;
    }
    if (countKnowledgeWords(kbContent) > 500) {
      setFormError(t.maxWords);
      return;
    }
    const existing = kbId === null ? null : knowledge.find((entry) => entry.id === kbId);
    if (kbId !== null && !existing?.recordId) {
      setFormError(t.knowledgeEntryMissing);
      return;
    }
    setKbSaving(true);
    setFormError("");
    try {
      const response = await fetch("/api/knowledge", {
        method: existing ? "PATCH" : "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(existing
          ? { id: existing.recordId, action: "edit", content: kbContent.trim() }
          : { content: kbContent.trim() }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || t.knowledgeSaveError);

      setConfirmOpen(false);
      go("kb");
      const refreshed = await onKnowledgeRefresh();
      showToast(refreshed ? "success" : "error", refreshed ? t.knowledgeSaved : t.knowledgeRefreshError);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : t.knowledgeSaveError);
    } finally {
      setKbSaving(false);
    }
  }

  async function archiveKnowledge(entry: KB) {
    if (!entry.recordId) return;
    setKbActionId(entry.recordId);
    try {
      const response = await fetch("/api/knowledge", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: entry.recordId, action: entry.archived ? "restore" : "archive" }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || t.knowledgeSaveError);

      const archived = !entry.archived;
      onKnowledgeChange(knowledge.map((row) => row.recordId === entry.recordId ? { ...row, archived } : row));
      const refreshed = await onKnowledgeRefresh();
      showToast(
        refreshed ? "success" : "error",
        refreshed
          ? archived ? t.knowledgeArchived : t.knowledgeRestored
          : t.knowledgeRefreshError,
      );
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : t.knowledgeSaveError);
    } finally {
      setKbActionId(null);
    }
  }

  function startNewProduct() {
    const fresh = blankProduct();
    setProductSku(null);
    setOriginalProduct(null);
    setProductDraft(fresh);
    setProductImageFiles([null, null]);
    setFieldErrors({});
    if (fileInputRefs[0].current) fileInputRefs[0].current.value = "";
    if (fileInputRefs[1].current) fileInputRefs[1].current.value = "";
    setProductNameFocused(false);
    setProductNameLimitReached(false);
    go("product-form");
  }

  function startEditProduct(item: Product) {
    setProductSku(item.sku);
    const cleanVariant = item.variant.trim();
    const isNA = item.unit === "NA" || cleanVariant === "NA";
    const numericPart = isNA ? "" : (cleanVariant.match(/^(\d+(?:\.\d+)?)/)?.[1] ?? cleanVariant);
    const unitPart = units.includes(item.unit as VariantUnit)
      ? item.unit
      : (cleanVariant.match(/\s*(g|kg|ml|l|box|packet|piece|NA)$/i)?.[1] ?? item.unit);
    const draft: ProductDraft = {
      ...item,
      variant: numericPart,
      unit: isNA ? "NA" : unitPart,
      photoNames: ["", ""],
    };
    setOriginalProduct(draft);
    setProductDraft({ ...draft });
    setProductImageFiles([null, null]);
    setFieldErrors({});
    if (fileInputRefs[0].current) fileInputRefs[0].current.value = "";
    if (fileInputRefs[1].current) fileInputRefs[1].current.value = "";
    go("product-form");
  }

  function setImage(index: number, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!allowedImageTypes.has(file.type)) {
      setFormError(t.imageFormatError);
      event.target.value = "";
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setFormError(t.imageSizeError);
      event.target.value = "";
      return;
    }
    const photos = [...productDraft.photos] as [string, string];
    if (photos[index].startsWith("blob:")) URL.revokeObjectURL(photos[index]);
    photos[index] = URL.createObjectURL(file);
    const photoNames = [...(productDraft.photoNames ?? ["", ""])] as [string, string];
    photoNames[index] = file.name;
    const imageFiles = [...productImageFiles] as [File | null, File | null];
    imageFiles[index] = file;
    setProductImageFiles(imageFiles);
    setProductDraft({ ...productDraft, photos, photoNames });
    event.target.value = "";
  }

  function removeImage(slot: 0 | 1) {
    const photos = [...productDraft.photos] as [string, string];
    const imagePaths = [...productDraft.imagePaths] as [string | null, string | null];
    const photoNames = [...(productDraft.photoNames ?? ["", ""])] as [string, string];
    const files = [...productImageFiles] as [File | null, File | null];

    if (photos[slot]?.startsWith("blob:")) {
      URL.revokeObjectURL(photos[slot]);
    }

    if (slot === 0) {
      const hasSecondImage = Boolean(photos[1] || imagePaths[1] || files[1]);
      if (hasSecondImage) {
        photos[0] = photos[1];
        imagePaths[0] = imagePaths[1];
        photoNames[0] = photoNames[1];
        files[0] = files[1];

        photos[1] = "";
        imagePaths[1] = null;
        photoNames[1] = "";
        files[1] = null;
      } else {
        photos[0] = "";
        imagePaths[0] = null;
        photoNames[0] = "";
        files[0] = null;
      }
    } else {
      photos[1] = "";
      imagePaths[1] = null;
      photoNames[1] = "";
      files[1] = null;
    }

    if (fileInputRefs[0].current) fileInputRefs[0].current.value = "";
    if (fileInputRefs[1].current) fileInputRefs[1].current.value = "";

    setProductDraft((current) => ({ ...current, photos, imagePaths, photoNames }));
    setProductImageFiles(files);
  }

  function validateProductDraft(draft: ProductDraft): FieldErrors {
    const errors: FieldErrors = {};
    if (!draft.name.trim()) {
      errors.name = t.nameRequired;
    }
    if (!draft.unit || !units.includes(draft.unit as VariantUnit)) {
      errors.unit = t.unitRequired;
    }
    if (draft.unit !== "NA") {
      const numVariant = Number(draft.variant.trim());
      if (!draft.variant.trim() || !Number.isFinite(numVariant) || numVariant <= 0 || !/^\d+(?:\.\d+)?$/.test(draft.variant.trim())) {
        errors.variant = t.variantRequired;
      }
    } else if (draft.variant.trim()) {
      const numVariant = Number(draft.variant.trim());
      if (!Number.isFinite(numVariant) || numVariant <= 0 || !/^\d+(?:\.\d+)?$/.test(draft.variant.trim())) {
        errors.variant = t.variantRequired;
      }
    }
    const scaledPrice = draft.price * 100;
    if (!Number.isFinite(draft.price) || draft.price <= 0 || draft.price > 9_999_999_999.99 || Math.abs(scaledPrice - Math.round(scaledPrice)) > 1e-8) {
      errors.price = t.priceRequired;
    }
    if (!draft.currency || !currencies.includes(draft.currency)) {
      errors.currency = t.currencyRequired;
    }
    if (draft.stock === null) {
      errors.stock = t.stockRequired;
    }
    return errors;
  }

  function focusFirstError(errors: FieldErrors) {
    const order: Array<keyof FieldErrors> = ["name", "variant", "unit", "price", "currency", "stock"];
    const firstKey = order.find((k) => Boolean(errors[k]));
    if (!firstKey) return;

    const idMap: Record<keyof FieldErrors, string> = {
      name: "product-name",
      variant: "product-variant",
      unit: "product-unit",
      price: "product-price",
      currency: "product-currency",
      stock: "product-stock",
    };
    const el = document.getElementById(idMap[firstKey]);
    if (el) {
      el.focus();
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  function handleRequestPublish() {
    setFormError("");
    const errors = validateProductDraft(productDraft);
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      focusFirstError(errors);
      return;
    }
    setFieldErrors({});
    setConfirmOpen(true);
  }

  async function publishProduct() {
    const errors = validateProductDraft(productDraft);
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      focusFirstError(errors);
      setConfirmOpen(false);
      return;
    }

    const editingSku = productSku;
    setProductSaving(true);
    setFormError("");
    setConfirmOpen(false);
    if (editingSku) {
      setRowSavingSku(editingSku);
    } else {
      setPendingNewProduct({ draft: { ...productDraft }, sku: null, loading: true });
    }
    setNotice("");
    setScreen("inventory");
    try {
      const isNA = productDraft.unit === "NA";
      const numVariant = isNA
        ? (productDraft.variant.trim() ? String(Number(productDraft.variant.trim())) : "")
        : String(Number(productDraft.variant.trim()));
      const data = {
        familyId: productDraft.familyId || undefined,
        familyName: productDraft.familyName || productDraft.name.trim(),
        name: productDraft.name.trim(),
        description: productDraft.description,
        variant: numVariant,
        unit: productDraft.unit || null,
        price: productDraft.price,
        currency: productDraft.currency || null,
        availability: productDraft.stock ? "in_stock" : "out_of_stock",
        imagePaths: productDraft.imagePaths,
      };
      const form = new FormData();
      form.set("product", JSON.stringify(data));
      productImageFiles.forEach((file, index) => {
        if (file) form.set(`image_${index + 1}`, file);
      });
      const endpoint = productSku
        ? `/api/inventory?sku=${encodeURIComponent(productSku)}`
        : "/api/inventory";
      const response = await fetch(endpoint, {
        method: productSku ? "PATCH" : "POST",
        credentials: "include",
        body: form,
      });
      const result = await response.json() as { error?: string; sku?: string };
      if (!response.ok) throw new Error(result.error || t.productSaveError);
      if (!editingSku && !result.sku) throw new Error(t.productSaveError);
      if (!editingSku) {
        setPendingNewProduct((pending) => pending ? { ...pending, sku: result.sku ?? null, loading: true } : pending);
      }
      const loadedProducts = await loadInventory();
      if (loadedProducts) {
        const newProductVisible = editingSku || loadedProducts.some((item) => item.sku === result.sku);
        if (newProductVisible) {
          setPendingNewProduct(null);
          productDraft.photos.forEach((photo) => {
            if (photo.startsWith("blob:")) URL.revokeObjectURL(photo);
          });
          setProductImageFiles([null, null]);
          showToast("success", t.inventorySaved);
        } else {
          setPendingNewProduct((pending) => pending ? { ...pending, sku: result.sku ?? null, loading: false } : pending);
          showToast("error", t.inventoryLoadError, true);
        }
      } else if (!editingSku) {
        setPendingNewProduct((pending) => pending ? { ...pending, loading: false } : pending);
      }
    } catch {
      setRowSavingSku(null);
      setPendingNewProduct(null);
      setScreen("product-form");
      showToast("error", t.productSaveError);
    } finally {
      setRowSavingSku(null);
      setProductSaving(false);
    }
  }

  async function archiveProduct(item: Product) {
    setArchivingSku(item.sku);
    try {
      const response = await fetch("/api/inventory", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sku: item.sku, action: item.archived ? "restore" : "archive" }),
      });
      if (!response.ok) throw new Error(t.inventoryActionError);
      setProducts((current) => current.map((row) =>
        row.sku === item.sku ? { ...row, archived: !item.archived } : row,
      ));
      const loadedProducts = await loadInventory();
      if (loadedProducts) showToast("success", item.archived ? t.productRestored : t.productArchived);
    } catch {
      showToast("error", t.inventoryActionError);
    } finally {
      setArchivingSku(null);
    }
  }

  function breadcrumb(section?: string) {
    return (
      <nav aria-label="Breadcrumb" className="portal-context">
        <button onClick={() => go("home")} type="button">{t.home}</button>
        {section && <><span aria-hidden="true">/</span><b>{section}</b></>}
      </nav>
    );
  }

  return (
    <div className={`portal-root portal-locale-${locale}`} lang={locale}>
      {screen === "home" && (
        <section className="portal-home">
          <p className="portal-home-eyebrow">{t.welcome}</p>
          <h1>{t.greeting}</h1>
          <div className="portal-home-cards">
            {([
              ["knowledge", "kb", "info"],
              ["inventory", "inventory", "image"],
            ] as const).map(([key, target, icon]) => (
              <button className="portal-home-card" key={key} onClick={() => go(target)} type="button">
                <span className="portal-card-icon"><Icon name={icon} size={34} /></span>
                <strong>{t[key]} <span aria-hidden="true">→</span></strong>
              </button>
            ))}
          </div>
          <a className="portal-home-request" href={whatsappUrl} rel="noopener noreferrer" target="_blank">
            {t.request} →
          </a>
        </section>
      )}

      {screen === "kb" && (
        <section className="portal-screen portal-list-screen">
          {breadcrumb(t.knowledge)}
          <div className="portal-title-row"><h1>{t.knowledge}</h1></div>
          <div className="portal-toolbar">
            <label className="portal-search">
              <Icon name="search" size={17} />
              <input aria-label={t.search} onChange={(event) => { setKbSearch(event.target.value); setKbPage(0); }} placeholder={`${t.search}…`} value={kbSearch} />
            </label>
            <button className="button button-primary" onClick={() => startKB()} type="button">
              <Icon name="plus" size={17} />{t.create}
            </button>
          </div>
          {knowledgeError && (
            <p className="field-error" role="alert">
              {knowledgeError} <button className="button button-outline" disabled={knowledgeLoading} onClick={() => void onKnowledgeRefresh()} type="button">{t.retry}</button>
            </p>
          )}
          <div className="portal-table-wrap">
            <table className="portal-table">
              <thead>
                <tr>
                  <th><button onClick={() => sortKB("id")} type="button"># ↕</button></th>
                  <th><button onClick={() => sortKB("updated")} type="button">{t.updated} ↕</button></th>
                  <th>{t.preview}</th>
                  <th>{t.actions}</th>
                </tr>
              </thead>
              <tbody>
                {shownKB.map((entry) => {
                  const actionBusy = kbActionId === entry.recordId;
                  return (
                    <tr aria-busy={actionBusy} className={entry.archived ? "row-archived" : ""} key={entry.recordId}>
                      <td className="portal-id">
                        {entry.id}
                        {actionBusy && <span className="portal-row-loading" role="status"><span className="portal-row-spinner" />{t.saving}</span>}
                      </td>
                      <td>{entry.updated}<small>{entry.updatedTime}</small></td>
                      <td>
                        <button className="portal-kb-content" onClick={() => startKB(entry)} type="button" title={entry.content}>
                          {entry.content}
                        </button>
                      </td>
                      <td className="portal-row-actions">
                        <button aria-label={`${t.edit} ${t.preview} ${entry.id}`} disabled={actionBusy || kbActionId !== null} onClick={() => startKB(entry)} title={t.edit} type="button"><Icon name="edit" size={16} /></button>
                        <button
                          aria-label={`${entry.archived ? t.restore : t.archive} ${t.preview} ${entry.id}`}
                          className={entry.archived ? "restore-action" : "archive-action"}
                          disabled={actionBusy || kbActionId !== null}
                          onClick={() => void archiveKnowledge(entry)}
                          title={entry.archived ? t.restore : t.archive}
                          type="button"
                        >
                          {entry.archived ? <Icon name="restore" size={16} /> : <Icon name="trash" size={16} />}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {knowledgeLoading && <p className="portal-empty" role="status">{t.knowledgeLoading}</p>}
            {!knowledgeLoading && !shownKB.length && !knowledgeError && <p className="portal-empty">{t.none}</p>}
          </div>
          <div className="portal-pagination">
            <span>{t.showing} {filteredKB.length ? `${currentKbPage * PAGE_SIZE + 1}–${currentKbPage * PAGE_SIZE + shownKB.length}` : "0"} {t.of} {filteredKB.length} {t.results}</span>
            <div className="portal-page-controls" aria-label={`${t.knowledge} ${t.pages}`}>
              <button disabled={currentKbPage === 0} onClick={() => setKbPage((page) => Math.max(0, page - 1))} type="button">{t.previous}</button>
              {Array.from({ length: kbPageCount }, (_, page) => (
                <button aria-current={page === currentKbPage ? "page" : undefined} key={page} onClick={() => setKbPage(page)} type="button">{page + 1}</button>
              ))}
              <button disabled={currentKbPage >= kbPageCount - 1} onClick={() => setKbPage((page) => Math.min(kbPageCount - 1, page + 1))} type="button">{t.next}</button>
            </div>
          </div>
        </section>
      )}

      {screen === "kb-form" && (
        <section className="portal-screen portal-form-screen portal-kb-form">
          {breadcrumb(t.knowledge)}
          <div className="portal-title-row">
            <div>
              <h1>{kbId === null ? `${t.newKnowledge} #${Math.max(0, ...knowledge.map((entry) => entry.id)) + 1}` : `${t.editKnowledge} #${knowledge.find((entry) => entry.id === kbId)?.id}`}</h1>
              <p>{t.hint}</p>
            </div>
          </div>
          <div className="portal-kb-editor">
            <label className="portal-field">
              <span className="visually-hidden">{t.content}</span>
              <textarea
                aria-label={t.content}
                aria-busy={voice.state === "transcribing"}
                autoFocus
                onChange={(event) => {
                  setKbContent(event.target.value);
                  kbContentRef.current = event.target.value;
                  kbCursorPosition.current = event.target.selectionStart;
                  setFormError("");
                }}
                onSelect={(event) => { kbCursorPosition.current = event.currentTarget.selectionStart; }}
                ref={kbTextareaRef}
                value={kbContent}
              />
            </label>
            {voice.state === "transcribing" && (
              <div aria-label={voiceLabels.transcribing} className="portal-kb-transcribing-dots" role="status">
                <span /><span /><span />
              </div>
            )}
            <div className="portal-kb-voice-control">
              <span aria-live="polite">{formatRecordingCountdown(voice.secondsRemaining)}</span>
              <button
                aria-label={voice.state === "recording" ? voiceLabels.stop : voice.state === "paused" ? voiceLabels.sendRecording : t.voice}
                aria-pressed={voice.state === "recording"}
                className={`portal-kb-voice${voice.state === "recording" ? " recording" : ""}${voice.state === "paused" ? " ready" : ""}`}
                disabled={voice.state === "requesting" || voice.state === "transcribing"}
                onClick={() => {
                  if (voice.state === "recording") {
                    voice.stop();
                  } else if (voice.state === "paused") {
                    const cursorPosition = kbTextareaRef.current?.selectionStart ?? kbCursorPosition.current;
                    void voice.send((transcript) => {
                      const insertion = insertKnowledgeTranscript(kbContentRef.current, transcript, cursorPosition);
                      if (countKnowledgeWords(insertion.content) > 500) {
                        voice.setError(voiceLabels.appendLimit);
                        return false;
                      }
                      setKbContent(insertion.content);
                      kbContentRef.current = insertion.content;
                      kbCursorPosition.current = insertion.cursor;
                      setFormError("");
                      requestAnimationFrame(() => {
                        const textarea = kbTextareaRef.current;
                        if (!textarea) return;
                        textarea.focus();
                        textarea.setSelectionRange(insertion.cursor, insertion.cursor);
                      });
                      return true;
                    }, undefined, {
                      resetAfterTranscription: true,
                      resetOnFailure: true,
                    });
                  } else {
                    void voice.start();
                  }
                }}
                title={voice.state === "recording" ? voiceLabels.stop : voice.state === "paused" ? voiceLabels.sendRecording : t.voice}
                type="button"
              >
                <Icon name={voice.state === "recording" ? "pause" : voice.state === "paused" ? "arrow-up" : "mic"} size={17} />
              </button>
            </div>
          </div>
          {voice.error && <p className="field-error" role="alert">{voice.error}</p>}
          <div className="portal-editor-meta">
            <span>{countKnowledgeWords(kbContent)} / 500 {t.words}</span>
            {(formError || countKnowledgeWords(kbContent) > 500) && <p className="field-error" role="alert">{formError || t.maxWords}</p>}
            <div className="portal-form-actions">
              <button className="button button-outline" onClick={() => go("kb")} type="button">{t.cancel}</button>
              <button className="button button-primary" disabled={kbSaving || countKnowledgeWords(kbContent) > 500 || (kbId === null ? !kbContent.trim() : kbContent.trim() === kbOriginalContent.trim())} onClick={() => { setFormError(""); setConfirmOpen(true); }} type="button">
                {kbId === null ? t.publish : t.publishChanges}
              </button>
            </div>
          </div>
        </section>
      )}

      {screen === "inventory" && (
        <section className="portal-screen portal-list-screen">
          {breadcrumb(t.inventory)}
          <div className="portal-title-row"><h1>{t.inventory}</h1></div>
          <div className="portal-toolbar">
            <label className="portal-search">
              <Icon name="search" size={17} />
              <input
                aria-label={t.search}
                onChange={(event) => { setItemSearch(event.target.value); setItemPage(0); }}
                placeholder={`${t.search} ${t.sku} / ${t.product}…`}
                value={itemSearch}
              />
            </label>
            <button className="button button-primary" onClick={startNewProduct} type="button">
              <Icon name="plus" size={17} />{t.create}
            </button>
          </div>
          <div className="portal-table-wrap">
            {inventoryLoading && !inventoryLoaded ? (
              <p className="portal-inventory-loading" role="status">{t.inventoryLoading}</p>
            ) : !inventoryLoaded ? (
              <p className="portal-empty">{t.inventoryLoadError}</p>
            ) : (
              <>
                <table className="portal-table portal-inventory-table">
                  <thead>
                    <tr>
                      <th><button onClick={() => sortItems("sku")} type="button"># ↕</button></th>
                      <th><button onClick={() => sortItems("updated")} type="button">{t.updated} ↕</button></th>
                      <th>{t.photo}</th>
                      <th>{t.product}</th>
                      <th>{t.variant}</th>
                      <th><button onClick={() => sortItems("price")} type="button">{t.price} ↕</button></th>
                      <th><button onClick={() => sortItems("stock")} type="button">{t.stock} ↕</button></th>
                      <th>{t.actions}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendingNewProduct && (
                      <tr aria-busy={pendingNewProduct.loading} className="portal-pending-row">
                        <td className="portal-id">
                          {pendingNewProduct.sku ?? t.generatingSku}
                          {pendingNewProduct.loading && <span className="portal-row-loading" role="status"><span className="portal-row-spinner" />{t.creatingProduct}</span>}
                        </td>
                        <td>{pendingNewProduct.loading ? t.creatingProduct : t.saved}</td>
                        <td>
                          {pendingNewProduct.draft.photos[0]
                            ? <img className="portal-photo" src={pendingNewProduct.draft.photos[0]} alt="" />
                            : <span className="portal-photo-placeholder"><Icon name="image" size={17} /></span>}
                        </td>
                        <td><strong>{pendingNewProduct.draft.name}</strong><small>{pendingNewProduct.draft.description}</small></td>
                        <td>{formatVariant(pendingNewProduct.draft.variant, pendingNewProduct.draft.unit)}</td>
                        <td>{pendingNewProduct.draft.currency
                          ? new Intl.NumberFormat(locale === "hi" ? "hi-IN" : "en-US", { style: "currency", currency: pendingNewProduct.draft.currency, maximumFractionDigits: 2 }).format(pendingNewProduct.draft.price)
                          : new Intl.NumberFormat(locale === "hi" ? "hi-IN" : "en-US").format(pendingNewProduct.draft.price)}</td>
                        <td>{pendingNewProduct.draft.stock ? t.yes : t.no}</td>
                        <td className="portal-row-actions">
                          {!pendingNewProduct.loading && <span className="portal-row-loading">{t.saved}</span>}
                        </td>
                      </tr>
                    )}
                    {shownProducts.map((item) => (
                      <tr aria-busy={archivingSku === item.sku || rowSavingSku === item.sku} className={item.archived ? "row-archived" : ""} key={item.sku}>
                        <td className="portal-id">
                          {item.sku}
                          {(archivingSku === item.sku || rowSavingSku === item.sku) && (
                            <span className="portal-row-loading" role="status"><span className="portal-row-spinner" />{t.saving}</span>
                          )}
                        </td>
                        <td>{item.updated}{item.updatedTime && <small>{item.updatedTime}</small>}</td>
                        <td>
                          {item.photos[0]
                            ? <img className="portal-photo" src={item.photos[0]} alt="" />
                            : <span className="portal-photo-placeholder"><Icon name="image" size={17} /></span>}
                        </td>
                        <td><strong>{item.name}</strong><small>{item.description}</small></td>
                        <td>{formatVariant(item.variant, item.unit)}</td>
                        <td>{item.currency
                          ? new Intl.NumberFormat(locale === "hi" ? "hi-IN" : "en-US", { style: "currency", currency: item.currency, maximumFractionDigits: 2 }).format(item.price)
                          : new Intl.NumberFormat(locale === "hi" ? "hi-IN" : "en-US").format(item.price)}</td>
                        <td><span className={`portal-stock ${item.stock ? "stock-yes" : "stock-no"}`}>{item.stock ? t.yes : t.no}</span></td>
                        <td className="portal-row-actions">
                          <button aria-label={`${t.edit} ${item.sku}`} disabled={archivingSku === item.sku || rowSavingSku === item.sku} onClick={() => startEditProduct(item)} title={t.edit} type="button"><Icon name="edit" size={16} /></button>
                          <button
                            aria-label={`${item.archived ? t.restore : t.archive} ${item.sku}`}
                            className={item.archived ? "restore-action" : "archive-action"}
                            disabled={archivingSku === item.sku || rowSavingSku === item.sku}
                            onClick={() => void archiveProduct(item)}
                            title={item.archived ? t.restore : t.archive}
                            type="button"
                          >
                            {item.archived ? <Icon name="restore" size={16} /> : <Icon name="trash" size={16} />}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!shownProducts.length && !pendingNewProduct && <p className="portal-empty">{t.none}</p>}
              </>
            )}
          </div>
          {inventoryLoaded && (
            <div className="portal-pagination">
              <span>{t.showing} {filteredProducts.length ? `${currentItemPage * PAGE_SIZE + 1}–${currentItemPage * PAGE_SIZE + shownProducts.length}` : "0"} {t.of} {filteredProducts.length} {t.results}</span>
              <div className="portal-page-controls" aria-label={`${t.inventory} ${t.pages}`}>
                <button disabled={currentItemPage === 0} onClick={() => setItemPage((page) => Math.max(0, page - 1))} type="button">{t.previous}</button>
                {Array.from({ length: itemPageCount }, (_, page) => (
                  <button aria-current={page === currentItemPage ? "page" : undefined} key={page} onClick={() => setItemPage(page)} type="button">{page + 1}</button>
                ))}
                <button disabled={currentItemPage >= itemPageCount - 1} onClick={() => setItemPage((page) => Math.min(itemPageCount - 1, page + 1))} type="button">{t.next}</button>
              </div>
            </div>
          )}
        </section>
      )}

      {screen === "product-form" && (
        <section className="portal-screen portal-form-screen portal-product-form">
          {breadcrumb(t.inventory)}
          <div className="portal-title-row">
            <h1>{productSku ? `${t.titleEdit} #${productSku}` : t.titleNew}</h1>
          </div>
          <div className="portal-form-card">
            <div className="portal-image-slots">
              {[0, 1].map((slot) => (
                <div className="portal-image-slot" key={slot}>
                  <label className="portal-image-thumb" htmlFor={`product-image-${slot}`}>
                    {productDraft.photos[slot]
                      ? <img src={productDraft.photos[slot]} alt={`${t.slot} ${slot + 1}`} />
                      : <span className="portal-image-placeholder"><Icon name="image" size={24} /></span>}
                  </label>
                  <div className="portal-image-copy">
                    <strong>{t.slot} #{slot + 1}</strong>
                    <span>{productDraft.photoNames?.[slot] || (productDraft.imagePaths[slot] ? productDraft.imagePaths[slot]?.split("/").at(-1) : productDraft.photos[slot] ? t.selectedImage : t.noImage)}</span>
                    <label className="portal-upload-button" htmlFor={`product-image-${slot}`}>
                      {productDraft.photos[slot] ? t.replacePhoto : t.addPhoto}
                    </label>
                    <input
                      accept="image/jpeg,image/png,image/webp,image/avif"
                      className="portal-image-input"
                      id={`product-image-${slot}`}
                      onChange={(event) => setImage(slot, event)}
                      ref={fileInputRefs[slot]}
                      type="file"
                    />
                    {Boolean(productDraft.photos[slot] || productDraft.imagePaths[slot]) && (
                      <button
                        className="portal-remove-image"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          removeImage(slot as 0 | 1);
                        }}
                        type="button"
                      >
                        {t.removePhoto}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="portal-product-fields">
              <div className="portal-field portal-field-wide portal-product-name-field">
                <label htmlFor="product-name">{t.name}</label>
                <div className="portal-product-name-control">
                  <input
                    aria-autocomplete="list"
                    aria-controls="product-name-suggestions"
                    aria-expanded={productNameFocused}
                    autoComplete="off"
                    id="product-name"
                    onBlur={() => setProductNameFocused(false)}
                    onChange={(event) => {
                      const name = limitWords(event.target.value, 10);
                      setProductNameLimitReached(name !== event.target.value);
                      const family = familyForProductName(name);
                      setProductDraft((current) => ({
                        ...current,
                        name,
                        ...(!productSku ? { familyId: family?.id ?? "", familyName: family?.familyName ?? name.trim() } : {}),
                      }));
                      if (fieldErrors.name) setFieldErrors((prev) => ({ ...prev, name: undefined }));
                    }}
                    onFocus={() => setProductNameFocused(true)}
                    role="combobox"
                    value={productDraft.name}
                  />
                  {productNameFocused && (
                    <div className="portal-name-suggestions" id="product-name-suggestions" role="listbox" aria-label={t.existingProductNames}>
                      {[...new Set(products.map((product) => product.name))]
                        .filter((name) => !productDraft.name || name.toLocaleLowerCase().includes(productDraft.name.toLocaleLowerCase()))
                        .map((name) => (
                          <button
                            key={name}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => {
                              const family = familyForProductName(name);
                              setProductDraft((current) => ({
                                ...current,
                                name,
                                ...(!productSku ? { familyId: family?.id ?? "", familyName: family?.familyName ?? name.trim() } : {}),
                              }));
                              setProductNameLimitReached(false);
                              setProductNameFocused(false);
                              if (fieldErrors.name) setFieldErrors((prev) => ({ ...prev, name: undefined }));
                            }}
                            role="option"
                            type="button"
                          >
                            {name}
                          </button>
                        ))}
                    </div>
                  )}
                </div>
                <small className="portal-word-count">{countWords(productDraft.name)} / 10 {t.words}</small>
                {productNameLimitReached && <span className="field-error" role="alert">{t.productNameMaxWords}</span>}
                {fieldErrors.name && <span className="field-error" role="alert">{fieldErrors.name}</span>}
              </div>
              <label className="portal-field portal-field-wide">
                {t.description}
                <textarea onChange={(event) => setProductDraft({ ...productDraft, description: event.target.value })} rows={3} value={productDraft.description} />
              </label>
              <div className="portal-field">
                <label htmlFor="product-variant">{t.value}</label>
                <div className="portal-inline-input">
                  <input
                    id="product-variant"
                    min="0"
                    onChange={(event) => {
                      setProductDraft({ ...productDraft, variant: event.target.value });
                      if (fieldErrors.variant) setFieldErrors((prev) => ({ ...prev, variant: undefined }));
                    }}
                    placeholder={locale === "hi" ? "जैसे 500" : "e.g. 500"}
                    step="any"
                    type="number"
                    value={productDraft.variant}
                  />
                  <select
                    aria-label={t.unit}
                    id="product-unit"
                    onChange={(event) => {
                      const newUnit = event.target.value;
                      setProductDraft({ ...productDraft, unit: newUnit });
                      if (fieldErrors.unit) setFieldErrors((prev) => ({ ...prev, unit: undefined }));
                      if (newUnit === "NA" && fieldErrors.variant && !productDraft.variant.trim()) {
                        setFieldErrors((prev) => ({ ...prev, variant: undefined }));
                      }
                    }}
                    value={units.includes(productDraft.unit as VariantUnit) ? productDraft.unit : ""}
                  >
                    <option disabled value="">{t.selectUnit}</option>
                    {units.map((unit) => (
                      <option key={unit} value={unit}>
                        {t.unitLabels[unit]}
                      </option>
                    ))}
                  </select>
                </div>
                {fieldErrors.variant && <span className="field-error" role="alert">{fieldErrors.variant}</span>}
                {fieldErrors.unit && <span className="field-error" role="alert">{fieldErrors.unit}</span>}
              </div>
              <div className="portal-field">
                <label htmlFor="product-price">{t.price}</label>
                <div className="portal-inline-input">
                  <input
                    id="product-price"
                    min="0"
                    onChange={(event) => {
                      setProductDraft({ ...productDraft, price: Number(event.target.value) });
                      if (fieldErrors.price) setFieldErrors((prev) => ({ ...prev, price: undefined }));
                    }}
                    step="any"
                    type="number"
                    value={productDraft.price || ""}
                  />
                  <select
                    aria-label={t.currency}
                    id="product-currency"
                    onChange={(event) => {
                      setProductDraft({ ...productDraft, currency: event.target.value });
                      if (fieldErrors.currency) setFieldErrors((prev) => ({ ...prev, currency: undefined }));
                    }}
                    value={productDraft.currency}
                  >
                    <option disabled value="">{t.selectCurrency}</option>
                    {currencies.map((currency) => <option key={currency} value={currency}>{currency}</option>)}
                  </select>
                </div>
                {fieldErrors.price && <span className="field-error" role="alert">{fieldErrors.price}</span>}
                {fieldErrors.currency && <span className="field-error" role="alert">{fieldErrors.currency}</span>}
              </div>
              <fieldset className="portal-stock-field" id="product-stock" tabIndex={-1}>
                <legend>{t.stock}</legend>
                <button
                  aria-pressed={productDraft.stock === true}
                  className={productDraft.stock === true ? "portal-stock-choice selected" : "portal-stock-choice"}
                  onClick={() => {
                    setProductDraft({ ...productDraft, stock: true });
                    setFormError("");
                    if (fieldErrors.stock) setFieldErrors((prev) => ({ ...prev, stock: undefined }));
                  }}
                  type="button"
                >
                  <span className="portal-stock-checkbox"><Icon name="check" size={15} /></span>{t.yes}
                </button>
                <button
                  aria-pressed={productDraft.stock === false}
                  className={`portal-stock-choice unavailable${productDraft.stock === false ? " selected" : ""}`}
                  onClick={() => {
                    setProductDraft({ ...productDraft, stock: false });
                    setFormError("");
                    if (fieldErrors.stock) setFieldErrors((prev) => ({ ...prev, stock: undefined }));
                  }}
                  type="button"
                >
                  <span className="portal-stock-checkbox"><Icon name="close" size={14} /></span>{t.no}
                </button>
                {fieldErrors.stock && <span className="field-error" role="alert">{fieldErrors.stock}</span>}
              </fieldset>
            </div>
          </div>
          {formError && <p className="field-error" role="alert">{formError}</p>}
          <div className="portal-form-footer">
            <div>
              <button className="button button-outline" onClick={() => go("inventory")} type="button">{t.cancel}</button>
              <button
                className="button button-primary"
                disabled={productSaving || (productSku ? !dirtyProduct : false)}
                onClick={handleRequestPublish}
                type="button"
              >
                {productSaving ? t.saving : t.publishChanges}<Icon name="arrow-up" size={17} />
              </button>
            </div>
          </div>
        </section>
      )}

      {screen === "request" && (
        <section className="portal-request">
          <h1>{t.requestTitle}</h1>
          <p>{t.requestHint}</p>
          <a className="button button-primary" href={whatsappUrl} rel="noopener noreferrer" target="_blank">
            <Icon name="send" size={17} />{t.whatsapp}
          </a>
        </section>
      )}

      {confirmOpen && screen === "product-form" && (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setConfirmOpen(false); }} role="presentation">
          <section aria-label={t.productPublishConfirm} aria-modal="true" className="dialog product-confirm-dialog" role="dialog">
            <p>{t.productPublishConfirm}</p>
            <div className="dialog-actions">
              <button className="button product-confirm-no" onClick={() => setConfirmOpen(false)} type="button">{t.no}</button>
              <button className="button button-primary" disabled={productSaving} onClick={() => void publishProduct()} type="button">{t.yes}</button>
            </div>
          </section>
        </div>
      )}
      {confirmOpen && screen === "kb-form" && (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setConfirmOpen(false); }} role="presentation">
          <section aria-labelledby="knowledge-publish-question" aria-modal="true" className="dialog product-confirm-dialog" role="dialog">
            <p id="knowledge-publish-question">{t.knowledgePublishConfirm}</p>
            <div className="dialog-actions">
              <button className="button product-confirm-no" onClick={() => setConfirmOpen(false)} type="button">{t.no}</button>
              <button className="button button-primary" disabled={kbSaving} onClick={() => void saveKB()} type="button">{kbSaving ? t.saving : t.yes}</button>
            </div>
          </section>
        </div>
      )}
      {toast && (
        <div aria-live={toast.kind === "error" ? "assertive" : "polite"} className={`portal-toast ${toast.kind}`} key={toast.id} role={toast.kind === "error" ? "alert" : "status"}>
          <span>{toast.message}</span>
          {toast.retry && <button onClick={() => { setToast(null); void loadInventory(); }} type="button">{t.retry}</button>}
        </div>
      )}
    </div>
  );
}
