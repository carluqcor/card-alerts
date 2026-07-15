import type { Page } from "playwright";
import { extractProductJsonLd } from "../helpers/structuredData.js";
import { parsePrice } from "../helpers/parse.js";
import type { ScrapeResult, TargetConfig } from "./types.js";

// Amazon rarely ships Product JSON-LD, so the CSS fallback below does most of the work.
const DEFAULT_PRICE_SELECTOR = "#corePrice_feature_div .a-price .a-offscreen, #priceblock_ourprice";
// A completely unavailable product (no price shown at all, Amazon shows substitute suggestions
// instead) renders a distinct `#outOfStock` buybox container, not just different text in the
// normal `#availability` block.
const OUT_OF_STOCK_SELECTOR = "#outOfStock";
const BUY_BUTTON_SELECTOR = "#add-to-cart-button, #buy-now-button";
// High-demand items (common for hyped Pokémon restocks) show a price but no direct buy button —
// instead a "request an invitation" flow gated behind approval. Treated as in-stock here (a
// deliberate choice — you can't buy immediately, but it does mean the listing is live and
// showing a price, which is the signal worth alerting on).
const REQUEST_INVITE_SELECTOR = "text=Solicitar invitación";
// The buybox can be won by a third-party marketplace seller instead of Amazon itself, especially
// once Amazon's own stock runs low — those listings are often price-gouged. This project only
// wants to track Amazon's own offer, so the merchant info is checked explicitly rather than
// trusting whatever wins the buybox (mirrors the seller_id filter used for Carrefour).
const MERCHANT_INFO_SELECTOR = "#merchantInfoFeature_feature_div";
const MAIN_IMAGE_SELECTOR = "#landingImage";
const HIGH_PRICE_WARNING_TEXT = "Precio más alto de lo habitual";

// null = couldn't verify (no merchant info rendered at all, e.g. on some "price higher than
// usual" pages) — deliberately distinct from `false` (a confirmed non-Amazon seller), since the
// caller treats "can't verify" and "confirmed other seller" the same way (don't trust this
// offer's price/stock) but they're different situations worth telling apart in raw data.
async function detectSoldByAmazon(page: Page): Promise<boolean | null> {
  const text = await page.locator(MERCHANT_INFO_SELECTOR).first().textContent().catch(() => null);
  const cleaned = text?.replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  return /\bAmazon\b/i.test(cleaned);
}

async function detectInStock(page: Page): Promise<boolean | null> {
  if ((await page.locator(BUY_BUTTON_SELECTOR).count()) > 0) return true;
  if ((await page.locator(REQUEST_INVITE_SELECTOR).count()) > 0) return true;
  return null;
}

// `src` renders at whatever size the page happened to lazy-load at capture time (observed
// anywhere from 355px to 879px, in wildly different aspect ratios) — visually inconsistent
// across products on the dashboard. `data-old-hires` is the canonical 1500px original Amazon
// keeps for every listing regardless of viewport, giving consistent quality across all products.
async function detectImageUrl(page: Page): Promise<string | null> {
  const img = page.locator(MAIN_IMAGE_SELECTOR).first();
  const hiRes = await img.getAttribute("data-old-hires").catch(() => null);
  if (hiRes) return hiRes;
  return img.getAttribute("src").catch(() => null);
}

export async function scrapeAmazon(page: Page, target: TargetConfig): Promise<ScrapeResult> {
  await page.goto(target.url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(2000);

  const imageUrl = await detectImageUrl(page);

  if ((await page.locator(OUT_OF_STOCK_SELECTOR).count()) > 0) {
    return { price: null, currency: null, inStock: false, imageUrl };
  }

  const soldByAmazon = await detectSoldByAmazon(page);
  if (soldByAmazon === false) {
    // A verified third-party offer, not Amazon's own — don't report its price/stock as if it
    // were the thing we're actually tracking.
    return { price: null, currency: null, inStock: null, imageUrl, note: "No vendido directamente por Amazon" };
  }

  const inStock = await detectInStock(page);
  if (!inStock) {
    // Ambiguous state (e.g. Amazon's own "precio más alto de lo habitual" warning, which hides
    // the numeric price) — don't guess a stock/price value we can't actually back up. Surface
    // *why* it's ambiguous when we can identify the specific cause, so this doesn't look
    // identical to "we failed to scrape this" on the dashboard.
    const hasPriceWarning = (await page.locator(`text=${HIGH_PRICE_WARNING_TEXT}`).count()) > 0;
    const note = hasPriceWarning
      ? "Precio más alto de lo habitual (posible reventa) — probablemente disponible"
      : "Estado de stock no verificado";
    return { price: null, currency: null, inStock: null, imageUrl, note };
  }

  const jsonLd = await extractProductJsonLd(page);
  if (jsonLd?.price != null) {
    return { ...jsonLd, inStock, imageUrl: jsonLd.imageUrl ?? imageUrl };
  }

  const priceText = await page
    .locator(target.priceSelector ?? DEFAULT_PRICE_SELECTOR)
    .first()
    .textContent()
    .catch(() => null);

  const { amount, currency } = parsePrice(priceText);

  return { price: amount, currency, inStock, imageUrl, raw: { priceText } };
}
