export interface TargetConfig {
  id: string;
  site: "amazon" | "carrefour";
  url: string;
  name: string;
  priceSelector?: string;
  stockSelector?: string;
  existingImageUrl?: string | null;
}

export interface ScrapeResult {
  price: number | null;
  currency: string | null;
  inStock: boolean | null;
  originalPrice?: number | null;
  promoLabel?: string | null;
  imageUrl?: string | null;
  raw?: unknown;
}
