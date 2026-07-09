import type { Page } from "playwright-core";
import { extractProductJsonLd } from "../helpers/structuredData.js";
import { parsePrice } from "../helpers/parse.js";
import type { ScrapeResult, TargetConfig } from "./types.js";

// Amazon rarely ships Product JSON-LD on the .es listing page, so the CSS fallback below
// does most of the work. Verify these selectors in devtools against a real product page —
// Amazon changes markup by locale/experiment and this may need adjusting.
const DEFAULT_PRICE_SELECTOR = "#corePrice_feature_div .a-price .a-offscreen, #priceblock_ourprice";
const DEFAULT_STOCK_SELECTOR = "#availability span";

export async function scrapeAmazon(page: Page, target: TargetConfig): Promise<ScrapeResult> {
  await page.goto(target.url, { waitUntil: "domcontentloaded", timeout: 30_000 });

  const jsonLd = await extractProductJsonLd(page);
  if (jsonLd?.price != null) {
    return jsonLd;
  }

  const priceText = await page
    .locator(target.priceSelector ?? DEFAULT_PRICE_SELECTOR)
    .first()
    .textContent()
    .catch(() => null);

  const stockText = await page
    .locator(target.stockSelector ?? DEFAULT_STOCK_SELECTOR)
    .first()
    .textContent()
    .catch(() => null);

  const { amount, currency } = parsePrice(priceText);
  const inStock = stockText
    ? !/no\s*disponible|agotad|no\s*hay\s*existencias/i.test(stockText)
    : null;

  return { price: amount, currency, inStock, raw: { priceText, stockText } };
}
