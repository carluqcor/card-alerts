import type { Page } from "playwright";
import { parsePrice } from "../helpers/parse.js";
import { pinSpainStorefront } from "../helpers/shopifyLocalization.js";
import type { ScrapeResult, TargetConfig } from "./types.js";

// pokemillon.com is a heavily customized Shopify store — its Product JSON-LD has no `offers`
// block at all (only ratings/reviews), and a generic `.price` selector is entirely occupied by
// an unrelated site-wide mega-menu sidebar widget (cross-category "featured" products bleeding
// into every page, not just this store's own collection cards). Price and stock both have to
// come from this store's own custom "pm-title-block" product section instead.
const ADD_BUTTON_SELECTOR = "button[name='add']";
// The theme splits the price into separate integer/decimal spans with no separator between them
// in the DOM (e.g. "169" + "90€" renders as "16990€" if read as one textContent) — these ids are
// stable across products (confirmed on multiple product pages), unlike the per-product-templated
// container id one level up.
const PRICE_INT_SELECTOR = "#pm-pdp-price-int";
const PRICE_DEC_SELECTOR = "#pm-pdp-price-dec";
const COMPARE_WRAPPER_SELECTOR = ".pm-title-block__compare";
const COMPARE_INT_SELECTOR = "#pm-pdp-compare-int";
const COMPARE_DEC_SELECTOR = "#pm-pdp-compare-dec";

async function detectInStock(page: Page): Promise<boolean | null> {
  const addButton = page.locator(ADD_BUTTON_SELECTOR).first();
  if ((await addButton.count()) === 0) return null;
  return !(await addButton.isDisabled());
}

// Reconstructs "169,90" from the split int/dec spans and reuses the shared Spanish-format
// parser rather than duplicating its comma/currency handling.
async function readSplitPrice(
  page: Page,
  intSelector: string,
  decSelector: string
): Promise<{ amount: number | null; currency: string | null }> {
  const intLocator = page.locator(intSelector).first();
  if ((await intLocator.count()) === 0) return { amount: null, currency: null };

  const intText = await intLocator.textContent().catch(() => null);
  const decText = await page
    .locator(decSelector)
    .first()
    .textContent()
    .catch(() => null);
  if (!intText || !decText) return { amount: null, currency: null };

  return parsePrice(`${intText.trim()},${decText.trim()}`);
}

async function detectOriginalPrice(page: Page): Promise<number | null> {
  const wrapper = page.locator(COMPARE_WRAPPER_SELECTOR).first();
  if ((await wrapper.count()) === 0) return null;
  // The compare block stays in the DOM even without an active discount, just hidden — showing
  // the same value as the current price rather than being absent, so visibility (not presence)
  // is what actually signals a real discount.
  if (!(await wrapper.isVisible().catch(() => false))) return null;

  const { amount } = await readSplitPrice(page, COMPARE_INT_SELECTOR, COMPARE_DEC_SELECTOR);
  return amount;
}

export async function scrapePokemillon(page: Page, target: TargetConfig): Promise<ScrapeResult> {
  await pinSpainStorefront(page.context(), "pokemillon.com");
  await page.goto(target.url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(2000);

  const inStock = await detectInStock(page);
  const originalPrice = await detectOriginalPrice(page);
  const { amount, currency } = await readSplitPrice(page, PRICE_INT_SELECTOR, PRICE_DEC_SELECTOR);

  if (amount != null) {
    return { price: amount, currency, inStock, originalPrice };
  }

  const priceText = await page
    .locator(target.priceSelector ?? PRICE_INT_SELECTOR)
    .first()
    .textContent({ timeout: 5000 })
    .catch(() => null);

  const parsed = parsePrice(priceText);

  return {
    price: parsed.amount,
    currency: parsed.currency,
    inStock,
    originalPrice,
    raw: { priceText },
  };
}
