import type { Page } from "playwright";
import { extractProductJsonLd } from "../helpers/structuredData.js";
import { parsePrice } from "../helpers/parse.js";
import { pinSpainStorefront } from "../helpers/shopifyLocalization.js";
import type { ScrapeResult, TargetConfig } from "./types.js";

// cardzone.es is a customized Shopify theme (not stock Dawn) — its buy button isn't the usual
// `button[name='add']`, and an unscoped button search also picks up "quick add" buttons from an
// unrelated recommended-products widget on the same page. Scoped to `.shopify-product-form`
// (present around both the main and sticky-bar copies of the real button, absent from the
// widget's cards) to avoid that collision. Its Product JSON-LD reports price/currency/
// availability reliably, so that's used as the primary source, with the scoped DOM button as a
// cross-check/fallback.
const ADD_BUTTON_SELECTOR = ".shopify-product-form button.button.w-full";
const COMPARE_PRICE_SELECTOR = ".shopify-product-form s, .shopify-product-form [class*='compare']";

async function detectInStock(page: Page): Promise<boolean | null> {
  const addButton = page.locator(ADD_BUTTON_SELECTOR).first();
  if ((await addButton.count()) === 0) return null;
  return !(await addButton.isDisabled());
}

async function detectOriginalPrice(page: Page): Promise<number | null> {
  const locator = page.locator(COMPARE_PRICE_SELECTOR).first();
  if ((await locator.count()) === 0) return null;
  const text = await locator.textContent().catch(() => null);
  return parsePrice(text).amount;
}

export async function scrapeCardzone(page: Page, target: TargetConfig): Promise<ScrapeResult> {
  await pinSpainStorefront(page.context(), "cardzone.es");
  await page.goto(target.url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(2000);

  const jsonLd = await extractProductJsonLd(page);
  const domInStock = await detectInStock(page);
  const originalPrice = await detectOriginalPrice(page);

  if (jsonLd?.price != null) {
    return {
      ...jsonLd,
      inStock: domInStock ?? jsonLd.inStock,
      originalPrice,
    };
  }

  const priceText = await page
    .locator(target.priceSelector ?? ".shopify-product-form [class*='price']")
    .first()
    .textContent({ timeout: 5000 })
    .catch(() => null);

  const { amount, currency } = parsePrice(priceText);

  return {
    price: amount,
    currency,
    inStock: domInStock,
    originalPrice,
    raw: { priceText },
  };
}
