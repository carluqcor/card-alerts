import type { Page } from "playwright";
import { pinSpainStorefront } from "../helpers/shopifyLocalization.js";
import type { ScrapeResult, TargetConfig } from "./types.js";

// hkbens-tr.myshopify.com (storefront brand: "Wini Games") renders a theme with a broken stock
// indicator — its buy button shows disabled with an "Agotado" badge on products that Shopify's
// own storefront inventory API reports as `available: true` (confirmed directly: every product
// checked this way was actually purchasable despite the DOM claiming otherwise). Rather than
// trust that broken rendering, this hits Shopify's own `/products/<handle>.js` JSON endpoint —
// the same data source the theme itself is supposed to reflect — for price, compare-at price,
// and availability directly, skipping DOM/theme rendering entirely.
function toJsonUrl(url: string): string {
  return `${url.split("?")[0]}.js`;
}

interface ShopifyProductJson {
  featured_image?: string | null;
  variants: {
    price: number;
    compare_at_price: number | null;
    available: boolean;
  }[];
}

export async function scrapeWiniGames(page: Page, target: TargetConfig): Promise<ScrapeResult> {
  await pinSpainStorefront(page.context(), "hkbens-tr.myshopify.com");

  const res = await page.request.get(toJsonUrl(target.url));
  const data = (await res.json()) as ShopifyProductJson;
  const variant = data.variants?.[0];
  if (!variant) {
    return { price: null, currency: null, inStock: null };
  }

  const price = variant.price / 100;
  const comparePrice = variant.compare_at_price != null ? variant.compare_at_price / 100 : null;
  const imageUrl = data.featured_image ? new URL(data.featured_image, "https://hkbens-tr.myshopify.com").toString() : null;

  return {
    price,
    currency: "EUR",
    inStock: variant.available,
    originalPrice: comparePrice != null && comparePrice > price ? comparePrice : null,
    imageUrl,
  };
}
