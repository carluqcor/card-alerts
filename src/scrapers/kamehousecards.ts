import type { Page } from "playwright";
import { parsePrice } from "../helpers/parse.js";
import { pinSpainStorefront } from "../helpers/shopifyLocalization.js";
import type { ScrapeResult, TargetConfig } from "./types.js";

// kamehousecards.com is a standard Shopify store, but its Product JSON-LD has no `offers`
// block, and a page-wide "predictive search" widget (recently-viewed/search-suggestion cards,
// present in the DOM even when its dropdown is closed) reuses the exact same generic Dawn price
// classes (`.price__regular`, `.price__sale`, ...) as the real product form — an unscoped
// selector picks up several unrelated products' prices instead of just this one. Scoping to the
// per-product `[id^='ProductInformation']` section (Shopify's own per-section id prefix) avoids
// that collision entirely.
const PRODUCT_INFO_SCOPE = "[id^='ProductInformation']";
const ADD_BUTTON_SELECTOR = "button[name='add']";
const REGULAR_PRICE_SELECTOR = ".price__regular";
const SALE_WRAPPER_SELECTOR = ".price__sale";
const SALE_PRICE_SELECTOR = ".price-item--sale";
const COMPARE_PRICE_SELECTOR = ".price-item--regular.compare-at-price";

async function detectInStock(page: Page): Promise<boolean | null> {
  const addButton = page.locator(PRODUCT_INFO_SCOPE).locator(ADD_BUTTON_SELECTOR).first();
  if ((await addButton.count()) === 0) return null;
  return !(await addButton.isDisabled());
}

// The theme keeps both the regular-price block and the sale-price wrapper in the DOM at all
// times, toggling a `price__hidden` class on whichever one doesn't apply — so visibility (not
// presence) of the sale wrapper is what actually signals an active discount, same pattern as
// the split price blocks seen on the other Shopify sites here.
async function detectPrice(page: Page): Promise<{ price: number | null; currency: string | null; originalPrice: number | null }> {
  const scope = page.locator(PRODUCT_INFO_SCOPE).first();
  const saleWrapper = scope.locator(SALE_WRAPPER_SELECTOR).first();
  const saleIsActive = (await saleWrapper.count()) > 0 && (await saleWrapper.isVisible().catch(() => false));

  if (saleIsActive) {
    const saleText = await saleWrapper.locator(SALE_PRICE_SELECTOR).first().textContent().catch(() => null);
    const compareText = await saleWrapper.locator(COMPARE_PRICE_SELECTOR).first().textContent().catch(() => null);
    const { amount, currency } = parsePrice(saleText);
    return { price: amount, currency, originalPrice: parsePrice(compareText).amount };
  }

  const regularText = await scope.locator(REGULAR_PRICE_SELECTOR).first().textContent().catch(() => null);
  const { amount, currency } = parsePrice(regularText);
  return { price: amount, currency, originalPrice: null };
}

export async function scrapeKameHouseCards(page: Page, target: TargetConfig): Promise<ScrapeResult> {
  await pinSpainStorefront(page.context(), "kamehousecards.com");
  await page.goto(target.url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(2000);

  const inStock = await detectInStock(page);
  const { price, currency, originalPrice } = await detectPrice(page);

  if (price != null) {
    return { price, currency, inStock, originalPrice };
  }

  const priceText = await page
    .locator(target.priceSelector ?? `${PRODUCT_INFO_SCOPE} ${REGULAR_PRICE_SELECTOR}`)
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
