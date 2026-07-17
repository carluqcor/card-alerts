import type { Page } from "playwright";
import type { ScrapeResult, TargetConfig } from "./types.js";

// flashstore.es's category/listing pages are behind a persistent Cloudflare "checking your
// browser" challenge that doesn't clear with waiting (unlike elpilarceleste.es's transient one),
// but individual product pages aren't. The Store API itself isn't blocked either, but a cold
// context's very first request landing there directly was observed getting challenged too — a
// real page visit first earns a cf_clearance cookie for the session, same fix as
// elpilarceleste.ts. Visiting the product page itself doubles as that warm-up.
const STORE_API_BASE = "https://flashstore.es/wp-json/wc/store/v1/products";

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

export async function scrapeFlashStore(page: Page, target: TargetConfig): Promise<ScrapeResult> {
  await page.goto(target.url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(3000);

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
