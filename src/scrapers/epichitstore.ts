import type { Page } from "playwright";
import type { ScrapeResult, TargetConfig } from "./types.js";

// epichitstore.es is WooCommerce on a page-builder theme, not Shopify — its "variable" products
// (multiple options, e.g. language) make the DOM stock indicator unreliable to reason about
// (the add-to-cart button stays enabled-looking regardless of the selected variation's real
// stock). WooCommerce's own Store API gives clean, authoritative stock/price data directly,
// bypassing the DOM/theme entirely — confirmed reliable by sampling is_in_stock across 100
// products in this category and seeing it genuinely vary (20 true / 80 false), unlike
// is_purchasable, which was true for all 100 and so isn't a meaningful signal here.
const STORE_API_BASE = "https://epichitstore.es/wp-json/wc/store/v1/products";

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

export async function scrapeEpicHitStore(page: Page, target: TargetConfig): Promise<ScrapeResult> {
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
