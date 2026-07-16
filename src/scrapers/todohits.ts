import type { Page } from "playwright";
import { extractProductJsonLd } from "../helpers/structuredData.js";
import { parsePrice } from "../helpers/parse.js";
import { pinSpainStorefront } from "../helpers/shopifyLocalization.js";
import type { ScrapeResult, TargetConfig } from "./types.js";

// todohits.com is a standard Shopify (Dawn-based) store. Its Product JSON-LD reports price and
// availability reliably, matching the DOM in testing — same as theboosterbox.es, unlike
// Carrefour's stale `availability`. The DOM buy-button state is still used as the authoritative
// stock signal for consistency with the rest of this project, falling back to JSON-LD if the
// button isn't found at all.
const ADD_BUTTON_SELECTOR = "button[name='add']";
// Scoped to the main product hero price block (`tpf-*`) — the page also has a "related
// products" widget with similarly-named but distinct classes (`tpr-*`) for *other* products.
const COMPARE_PRICE_SELECTOR = ".tpf-price--compare";

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

export async function scrapeTodoHits(page: Page, target: TargetConfig): Promise<ScrapeResult> {
  await pinSpainStorefront(page.context(), "todohits.com");
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
    .locator(target.priceSelector ?? ".tpf-price--sale")
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
