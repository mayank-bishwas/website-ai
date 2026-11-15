import { products } from "./mock-data";
import type { AskMessage } from "./ask/types";

export type Message = AskMessage;

export type ProductDraft = {
  name: string;
  category: string;
  pack: string;
  price: string;
  description: string;
  availability: string;
};

export type MockImage = {
  name: string;
  src: string;
};

export function generateSku(productName: string, sequence = 1): string {
  const productCode = productName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "")
    .toUpperCase()
    .slice(0, 8);

  return `SM-${productCode || "ITEM"}-${String(sequence).padStart(3, "0")}`;
}

export function readImageFile(file: File): Promise<MockImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error(`Could not preview ${file.name}.`));
        return;
      }
      resolve({ name: file.name, src: reader.result });
    };
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}
