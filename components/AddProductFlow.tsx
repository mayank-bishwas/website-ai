"use client";

import { ChangeEvent, FormEvent, useRef } from "react";
import { MockImage, ProductDraft } from "@/lib/interactions";
import { editText, Locale } from "@/lib/portal-i18n";
import { Icon } from "./Icon";

type Props = {
  draft: ProductDraft;
  onDraftChange: (draft: ProductDraft) => void;
  images: MockImage[];
  onImagesSelected: (files: FileList | null) => void;
  onRemoveImage: (index: number) => void;
  onReview: () => void;
  error: string;
  locale: Locale;
};

export function AddProductFlow({
  draft,
  onDraftChange,
  images,
  onImagesSelected,
  onRemoveImage,
  onReview,
  error,
  locale,
}: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const t = editText[locale];

  function update(field: keyof ProductDraft, value: string) {
    onDraftChange({ ...draft, [field]: value });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onReview();
  }

  function selectImages(event: ChangeEvent<HTMLInputElement>) {
    onImagesSelected(event.target.files);
    event.target.value = "";
  }

  return (
    <form className="workflow-form" onSubmit={submit}>
      <div className="form-heading">
        <div>
          <p className="eyebrow">{t.newCatalogEntry}</p>
          <h3>{t.productDetails}</h3>
        </div>
        <span className="step-count">{t.stepOne}</span>
      </div>
      <div className="form-grid">
        <label className="form-field">
          {t.productName} <span aria-label={t.required} className="required">*</span>
          <input autoComplete="off" onChange={(event) => update("name", event.target.value)} placeholder={t.productNamePlaceholder} required value={draft.name} />
        </label>
        <label className="form-field">
          {t.category} <span aria-label={t.required} className="required">*</span>
          <select onChange={(event) => update("category", event.target.value)} required value={draft.category}>
            <option value="">{t.selectCategory}</option>
            <option value="Nuts">{t.nuts}</option>
            <option value="Seeds">{t.seeds}</option>
            <option value="Dried fruit">{t.driedFruit}</option>
            <option value="Gift boxes">{t.giftBoxes}</option>
            <option value="Other">{t.other}</option>
          </select>
        </label>
        <label className="form-field">
          {t.packSize} <span aria-label={t.required} className="required">*</span>
          <input onChange={(event) => update("pack", event.target.value)} placeholder={t.packPlaceholder} required value={draft.pack} />
        </label>
        <label className="form-field">
          {t.retailPrice} <span aria-label={t.required} className="required">*</span>
          <input min="1" onChange={(event) => update("price", event.target.value)} placeholder={t.pricePlaceholder} required type="number" value={draft.price} />
        </label>
        <label className="form-field form-field-wide">
          {t.productDescription}
          <textarea onChange={(event) => update("description", event.target.value)} placeholder={t.descriptionPlaceholder} rows={3} value={draft.description} />
        </label>
        <label className="form-field">
          {t.availability}
          <select onChange={(event) => update("availability", event.target.value)} value={draft.availability}>
            <option value="Available">{t.available}</option>
            <option value="Unavailable">{t.unavailable}</option>
          </select>
        </label>
      </div>
      <div className="upload-field">
        <div>
          <span className="upload-label">{t.productImages}</span>
          <span className="upload-hint">{t.upToImages}</span>
        </div>
        <input accept="image/*" aria-hidden="true" className="visually-hidden" hidden multiple onChange={selectImages} ref={fileInput} tabIndex={-1} type="file" />
        <button className="button button-outline" disabled={images.length >= 2} onClick={() => fileInput.current?.click()} type="button">
          <Icon name="plus" size={17} />{t.addImages}
        </button>
      </div>
      {images.length > 0 && (
        <div className="image-grid">
          {images.map((image, index) => (
            <div className="uploaded-image" key={`${image.name}-${index}`}>
              <img alt={image.name} src={image.src} />
              <span title={image.name}>{image.name}</span>
              <button aria-label={`${t.removeImage} ${image.name}`} className="preview-remove" onClick={() => onRemoveImage(index)} type="button">
                <Icon name="close" size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="form-footer">
        <p>{t.skuAuto}</p>
        <button className="button button-primary" type="submit">
          {t.reviewProduct} <Icon name="arrow-up" size={17} />
        </button>
      </div>
    </form>
  );
}
