import type { Browser } from "playwright";
import { launchBrowser } from "./browser.js";

const STORE_API_BASE = "https://flashstore.es/wp-json/wc/store/v1/products";
const CATEGORY_ID = 20; // "Cartas Pokemon" — confirmed via /products/categories?search=pokemon
// The Store API's own attribute/attribute_term query params are confirmed non-functional here
// (identical result count with any term, or none at all) — filtering for Spanish only works by
// checking each product's attributes client-side instead.
const IDIOMA_TAXONOMY = "pa_idioma";
const IDIOMA_ESPANOL_SLUG = "espanol";
const PER_PAGE = 100;
const MAX_PAGES = 20;

export interface CategoryProduct {
  url: string;
  name: string;
}

interface StoreApiAttribute {
  taxonomy: string;
  terms: { slug: string }[];
}

interface StoreApiProduct {
  name: string;
  permalink: string;
  attributes?: StoreApiAttribute[];
}

function isSpanish(product: StoreApiProduct): boolean {
  return (product.attributes ?? []).some(
    (attr) => attr.taxonomy === IDIOMA_TAXONOMY && attr.terms.some((t) => t.slug === IDIOMA_ESPANOL_SLUG)
  );
}

// The category/listing HTML pages are behind a persistent Cloudflare challenge (see
// src/scrapers/flashstore.ts) that a real product-page visit gets past fine, earning a
// cf_clearance cookie for the session — the Store API calls below ride on that same session
// rather than being hit cold, since a fresh context's very first request landing on the API
// directly was observed getting challenged too (Cloudflare's scoring isn't purely about which
// URL is requested — a session with no prior "real" navigation reads as suspicious on its own).
export async function crawlFlashStoreListing(): Promise<CategoryProduct[]> {
  const browser = await launchBrowser();
  try {
    const context = await browser.newContext({
      locale: "es-ES",
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    });
    try {
      const page = await context.newPage();
      await page.goto("https://flashstore.es/", { waitUntil: "domcontentloaded", timeout: 45_000 });
      await page.waitForTimeout(6000);

      const products: CategoryProduct[] = [];

      for (let pageNumber = 1; pageNumber <= MAX_PAGES; pageNumber++) {
        const url = `${STORE_API_BASE}?category=${CATEGORY_ID}&per_page=${PER_PAGE}&page=${pageNumber}`;
        const res = await page.request.get(url);
        const batch = (await res.json()) as StoreApiProduct[];
        if (batch.length === 0) break;

        for (const product of batch) {
          if (isSpanish(product)) products.push({ url: product.permalink, name: product.name });
        }

        if (batch.length < PER_PAGE) break;
      }

      return products;
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }
}
