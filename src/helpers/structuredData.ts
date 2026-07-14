import type { Page } from "playwright";

interface ProductJsonLd {
  price: number | null;
  currency: string | null;
  inStock: boolean | null;
  imageUrl: string | null;
}

function findProductCandidates(parsed: unknown): Record<string, unknown>[] {
  const items = Array.isArray(parsed) ? parsed : [parsed];
  return items.flatMap((item) => {
    const record = item as Record<string, unknown>;
    const graph = record?.["@graph"];
    return Array.isArray(graph) ? graph : [record];
  });
}

// schema.org's `image` can legitimately be a plain URL string, an array of them, or a full
// ImageObject with its own `.url` (seen on todohits.com) — handle all three shapes.
function extractImageUrl(image: string | string[] | { url?: string } | undefined): string | null {
  const candidate = Array.isArray(image) ? image[0] : image;
  if (typeof candidate === "string") return candidate;
  if (typeof candidate === "object" && candidate !== null) return candidate.url ?? null;
  return null;
}

function parseProductCandidate(candidate: Record<string, unknown>): ProductJsonLd | null {
  if (candidate?.["@type"] !== "Product") return null;

  const offers = candidate.offers as Record<string, unknown> | Record<string, unknown>[] | undefined;
  const offer = Array.isArray(offers) ? offers[0] : offers;
  if (!offer) return null;

  const rawPrice = offer.price as string | number | undefined;
  const price = rawPrice ? Number.parseFloat(String(rawPrice)) : null;
  const availability = offer.availability as string | undefined;
  const inStock = availability ? availability.toLowerCase().includes("instock") : null;

  const imageUrl = extractImageUrl(candidate.image as string | string[] | { url?: string } | undefined);

  return {
    price: Number.isFinite(price) ? price : null,
    currency: (offer.priceCurrency as string) ?? null,
    inStock,
    imageUrl,
  };
}

// Most e-commerce sites embed schema.org Product/Offer data in a <script type="application/ld+json">
// tag. It's far more stable across redesigns than scraping CSS classes, so try this first.
export async function extractProductJsonLd(page: Page): Promise<ProductJsonLd | null> {
  const blocks = await page.$$eval('script[type="application/ld+json"]', (nodes) =>
    nodes.map((n) => n.textContent ?? "")
  );

  for (const block of blocks) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(block);
    } catch {
      continue; // Not valid JSON, skip this block.
    }

    for (const candidate of findProductCandidates(parsed)) {
      const result = parseProductCandidate(candidate);
      if (result) return result;
    }
  }

  return null;
}
