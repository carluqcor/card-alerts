import type { Page } from "playwright";
import type { ScrapeResult, TargetConfig } from "./types.js";

// elpilarceleste.es is WooCommerce (WoodMart theme) behind Cloudflare's "checking your browser"
// JS challenge — a direct request (curl, or Playwright's page.request without visiting a real
// page first) gets the interstitial HTML instead of real content. A real page visit passes the
// challenge and earns a cf_clearance cookie for the session, after which WooCommerce's own
// Store API (shared with epichitstore.es's approach) gives clean, authoritative price/stock
// data — more reliable than reasoning about this theme's DOM.
const STORE_API_BASE = "https://elpilarceleste.es/wp-json/wc/store/v1/products";

interface StoreApiProduct {
  is_in_stock: boolean;
  prices: {
    price: string;
    regular_price: string;
    currency_minor_unit: number;
    currency_code: string;
  };
  images?: { src: string }[];
}

function slugFromUrl(url: string): string {
  const match = url.match(/\/producto\/([^/?]+)/);
  if (!match) throw new Error(`Could not extract product slug from URL: ${url}`);
  return match[1];
}

export async function scrapeElPilarCeleste(page: Page, target: TargetConfig): Promise<ScrapeResult> {
  // Doubles as the Cloudflare warm-up visit needed before the Store API call below will work.
  await page.goto(target.url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(6000);

  const slug = slugFromUrl(target.url);
  const res = await page.request.get(`${STORE_API_BASE}?slug=${encodeURIComponent(slug)}`);
  const [data] = (await res.json()) as StoreApiProduct[];
  if (!data) {
    return { price: null, currency: null, inStock: null };
  }

  const divisor = 10 ** data.prices.currency_minor_unit;
  const price = Number(data.prices.price) / divisor;
  const regularPrice = Number(data.prices.regular_price) / divisor;

  return {
    price,
    currency: data.prices.currency_code,
    inStock: data.is_in_stock,
    originalPrice: regularPrice > price ? regularPrice : null,
    imageUrl: data.images?.[0]?.src ?? null,
  };
}
