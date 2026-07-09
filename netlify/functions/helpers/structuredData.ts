import type { Page } from "playwright-core";

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

function parseProductCandidate(candidate: Record<string, unknown>): ProductJsonLd | null {
  if (candidate?.["@type"] !== "Product") return null;

  const offers = candidate.offers as Record<string, unknown> | Record<string, unknown>[] | undefined;
  const offer = Array.isArray(offers) ? offers[0] : offers;
  if (!offer) return null;

  const rawPrice = offer.price as string | number | undefined;
  const price = rawPrice ? Number.parseFloat(String(rawPrice)) : null;
  const availability = offer.availability as string | undefined;
  const inStock = availability ? availability.toLowerCase().includes("instock") : null;

  const image = candidate.image as string | string[] | undefined;
  const imageUrl = Array.isArray(image) ? image[0] : image;

  return {
    price: Number.isFinite(price) ? price : null,
    currency: (offer.priceCurrency as string) ?? null,
    inStock,
    imageUrl: typeof imageUrl === "string" ? imageUrl : null,
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
