export type Product = {
  name: string;
  category: string;
  variants: { pack: string; price: number; available: boolean }[];
};

export const merchant = {
  name: "Shahi Meva",
  tagline: "Dry fruits & more",
};

export const products: Product[] = [
  {
    name: "Kaju (Cashews)",
    category: "Nuts",
    variants: [
      { pack: "500 g", price: 550, available: true },
      { pack: "1 kg", price: 1050, available: true },
    ],
  },
  {
    name: "Almonds",
    category: "Nuts",
    variants: [
      { pack: "250 g", price: 310, available: true },
      { pack: "500 g", price: 600, available: false },
    ],
  },
  {
    name: "Mamra Badam",
    category: "Premium nuts",
    variants: [{ pack: "250 g", price: 850, available: true }],
  },
  {
    name: "Pistachios",
    category: "Nuts",
    variants: [{ pack: "250 g", price: 420, available: true }],
  },
  {
    name: "Lotus Seeds",
    category: "Seeds",
    variants: [{ pack: "200 g", price: 350, available: true }],
  },
];

export const editActions = [
  "Add product",
  "Add variant",
  "Update product",
  "Change availability",
  "Archive product",
] as const;

export type EditAction = (typeof editActions)[number];
