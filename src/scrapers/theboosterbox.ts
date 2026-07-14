import type { Page } from "playwright";
import { extractProductJsonLd } from "../helpers/structuredData.js";
import { parsePrice } from "../helpers/parse.js";
import type { ScrapeResult, TargetConfig } from "./types.js";

// theboosterbox.es is a standard Shopify store. Its Product JSON-LD (price/currency/availability)
// tested reliable against both an in-stock and a genuinely sold-out product, unlike Carrefour's
// stale `availability` — but the DOM buy-button state is still used as the authoritative stock
// signal for consistency with the rest of this project's defensive pattern, falling back to
// JSON-LD only if neither button state is found.
const ADD_BUTTON_SELECTOR = "button[name='add']";
// When sold out, the theme swaps the whole buy button for a disabled "restock notice" button
// rather than just disabling the same button — so absence of the add button isn't itself
// meaningful, only the presence of this specific replacement is.
const RESTOCK_BUTTON_SELECTOR = "[class*='bb-buy__btn--restock']";
// Scoped to the main product-info price block (`bb-price__*`) — the page also has a cross-sell
// widget with similarly-named but distinct classes (`bb-cross__price*`) for *other* products.
const COMPARE_PRICE_SELECTOR = ".bb-price__compare";
const DISCOUNT_TEXT_SELECTOR = ".bb-price__discount";

async function detectInStock(page: Page): Promise<boolean | null> {
  const addButton = page.locator(ADD_BUTTON_SELECTOR).first();
  if ((await addButton.count()) > 0) {
    return !(await addButton.isDisabled());
  }
  if ((await page.locator(RESTOCK_BUTTON_SELECTOR).count()) > 0) return false;
  return null;
}

async function detectOriginalPrice(page: Page): Promise<number | null> {
  const locator = page.locator(COMPARE_PRICE_SELECTOR).first();
  if ((await locator.count()) === 0) return null;
  const text = await locator.textContent().catch(() => null);
  return parsePrice(text).amount;
}

async function detectPromoLabel(page: Page): Promise<string | null> {
  const locator = page.locator(DISCOUNT_TEXT_SELECTOR).first();
  if ((await locator.count()) === 0) return null;
  const text = await locator.textContent().catch(() => null);
  return text ? text.trim() : null;
}

export async function scrapeBoosterBox(page: Page, target: TargetConfig): Promise<ScrapeResult> {
  await page.goto(target.url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(2000);

  const jsonLd = await extractProductJsonLd(page);
  const domInStock = await detectInStock(page);
  const originalPrice = await detectOriginalPrice(page);
  const promoLabel = await detectPromoLabel(page);

  if (jsonLd?.price != null) {
    return {
      ...jsonLd,
      inStock: domInStock ?? jsonLd.inStock,
      originalPrice,
      promoLabel,
    };
  }

  const priceText = await page
    .locator(target.priceSelector ?? ".bb-price__current")
    .first()
    .textContent({ timeout: 5000 })
    .catch(() => null);

  const { amount, currency } = parsePrice(priceText);

  return {
    price: amount,
    currency,
    inStock: domInStock,
    originalPrice,
    promoLabel,
    raw: { priceText },
  };
}
