export interface TargetConfig {
  id: string;
  site: "amazon" | "carrefour" | "boosterbox" | "todohits";
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
  campaignLabel?: string | null;
  imageUrl?: string | null;
  // A deliberate, understood reason price/stock came back null (e.g. Amazon hiding an inflated
  // price) — distinct from a genuinely failed/empty scrape. Its presence tells the orchestrator
  // in scrape.ts not to treat this null result as a failure worth retrying-then-discarding, and
  // tells the dashboard to show *why* instead of a generic "unknown" status.
  note?: string | null;
  raw?: unknown;
}
