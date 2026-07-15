import type { Page } from "playwright";
import { extractProductJsonLd } from "../helpers/structuredData.js";
import { parsePrice } from "../helpers/parse.js";
import { isOwnedStorageUrl, uploadProductImage } from "../helpers/storage.js";
import type { ScrapeResult, TargetConfig } from "./types.js";

// Carrefour.es embeds schema.org Product/Offer JSON-LD, and its price is reliable — but its
// `availability` field is frequently stale (seen reporting "InStock" for a product whose page
// showed "Agotado temporalmente"). So price comes from JSON-LD, but stock status always comes
// from the buybox DOM instead: the "Añadir" button becomes "Agotado temporalmente" with a
// `--sold-out` modifier class when the Carrefour-sold offer (not marketplace sellers) is out.
const DEFAULT_PRICE_SELECTOR = '[data-testid="product-price"], .buybox-price';
const SOLD_OUT_SELECTOR = ".buybox__buy--sold-out";
const BUYBOX_SELECTOR = ".buybox__buy";
const STRIKETHROUGH_PRICE_SELECTOR = ".buybox__price-strikethrough";
// Covers every per-unit discount mechanic Carrefour runs (2nd-unit discount, 3x2, etc.)
// generically — the badge's `title` attribute always holds the exact promo text, e.g.
// "2ª unidad -70%" or "3x2".
const PROMO_BADGE_SELECTOR = ".buybox__badge-promotions .badge__name";
// A separate red "campaign" ribbon for site-wide sales events (e.g. "Weekend Sales"), distinct
// from the per-unit promo badge above — a product can have either, both, or neither.
const CAMPAIGN_BADGE_SELECTOR = ".buybox__badge-campaign .badge__name";
const SELLER_NAME_SELECTOR = ".buybox__seller-name";

interface CapturedImage {
  bytes: Buffer;
  contentType: string;
}

// static.carrefour.es hotlink-protects images (403 for any request that isn't a real browser
// session that passed Cloudflare's challenge) — so a separate fetch/page.request.get() call
// always gets blocked, even with matching cookies and Referer. The only request that actually
// succeeds is the one the rendered page issues itself for its own <img> tags, so we capture
// that response's bytes directly instead of re-requesting the URL out of band.
function registerImageCapture(page: Page): Map<string, CapturedImage> {
  const captured = new Map<string, CapturedImage>();
  page.on("response", (res) => {
    const url = res.url();
    if (!url.includes("static.carrefour.es") || res.status() !== 200) return;
    if (!/\.(jpe?g|png|webp)(\?|$)/i.test(url)) return;

    res
      .body()
      .then((bytes) => {
        captured.set(url, { bytes, contentType: res.headers()["content-type"] ?? "image/jpeg" });
      })
      .catch(() => {
        // Response body no longer available (e.g. page navigated away) — skip.
      });
  });
  return captured;
}

async function resolveImageUrl(
  target: TargetConfig,
  rawImageUrl: string | null,
  captured: Map<string, CapturedImage>
): Promise<string | null> {
  if (isOwnedStorageUrl(target.existingImageUrl)) {
    return target.existingImageUrl ?? null;
  }
  if (!rawImageUrl) return target.existingImageUrl ?? null;

  // The image response may still be in flight; give it a moment to land in the capture map.
  for (let i = 0; i < 6 && !captured.has(rawImageUrl); i++) {
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  const image = captured.get(rawImageUrl);
  if (!image) return target.existingImageUrl ?? null;

  return uploadProductImage(`${target.id}.jpg`, image.bytes, image.contentType);
}

// The category listing these targets were discovered from was filtered to "sold by Carrefour"
// at discovery time, but that doesn't guarantee the CURRENT buybox is still fulfilled by
// Carrefour — other marketplace sellers can win the same product page's buybox later (observed:
// "Vendido por Infopavon", "Vendido por Stock Network" instead of Carrefour, often at a higher
// price). Verify explicitly on every check, mirroring the same seller check used for Amazon.
async function detectSoldByCarrefour(page: Page): Promise<boolean | null> {
  const text = await page.locator(SELLER_NAME_SELECTOR).first().textContent().catch(() => null);
  const cleaned = text?.replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  return /\bCarrefour\b/i.test(cleaned);
}

async function detectInStock(page: Page): Promise<boolean | null> {
  const soldOutCount = await page.locator(SOLD_OUT_SELECTOR).count();
  if (soldOutCount > 0) return false;

  const buyboxCount = await page.locator(BUYBOX_SELECTOR).count();
  if (buyboxCount > 0) return true;

  return null;
}

async function detectOriginalPrice(page: Page): Promise<number | null> {
  const locator = page.locator(STRIKETHROUGH_PRICE_SELECTOR).first();
  // .count() checks the current DOM immediately with no waiting, unlike .textContent()/
  // .getAttribute() which auto-wait up to their full timeout before giving up on a missing
  // element — most products have no strikethrough price, so that wait was pure dead time.
  if ((await locator.count()) === 0) return null;
  const text = await locator.textContent().catch(() => null);
  return parsePrice(text).amount;
}

async function detectBadgeLabel(page: Page, selector: string): Promise<string | null> {
  const badge = page.locator(selector).first();
  if ((await badge.count()) === 0) return null;

  const title = await badge.getAttribute("title").catch(() => null);
  if (title) return title.trim();

  const text = await badge.textContent().catch(() => null);
  return text ? text.trim() : null;
}

export async function scrapeCarrefour(page: Page, target: TargetConfig): Promise<ScrapeResult> {
  const imageCapture = registerImageCapture(page);

  await page.goto(target.url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  // JSON-LD and the buybox render client-side after domcontentloaded fires, and $$eval/.count()
  // don't auto-wait the way click()/textContent() do — without this, a slow render (more common
  // on the serverless Lambda's CPU than locally) reads the DOM before either has appeared,
  // producing a false null for both price and stock.
  await page.waitForTimeout(2000);

  let jsonLd = await extractProductJsonLd(page);
  // Some pages consistently render slower than the fixed wait covers (observed repeatedly on
  // specific URLs in production, not locally — likely extra Cloudflare scrutiny on Netlify's
  // IP range). One retry with a longer wait recovers most of these before giving up.
  if (jsonLd == null && (await page.locator(BUYBOX_SELECTOR).count()) === 0) {
    await page.waitForTimeout(4000);
    jsonLd = await extractProductJsonLd(page);
  }

  const imageUrl = await resolveImageUrl(target, jsonLd?.imageUrl ?? null, imageCapture);

  const soldByCarrefour = await detectSoldByCarrefour(page);
  if (soldByCarrefour === false) {
    // A verified third-party marketplace offer, not Carrefour's own — don't report its
    // price/stock as if it were the thing we're actually tracking.
    return { price: null, currency: null, inStock: null, imageUrl, note: "No vendido directamente por Carrefour" };
  }

  const inStock = await detectInStock(page);
  const originalPrice = await detectOriginalPrice(page);
  const promoLabel = await detectBadgeLabel(page, PROMO_BADGE_SELECTOR);
  const campaignLabel = await detectBadgeLabel(page, CAMPAIGN_BADGE_SELECTOR);

  if (jsonLd?.price != null) {
    return { ...jsonLd, inStock, originalPrice, promoLabel, campaignLabel, imageUrl };
  }

  const priceText = await page
    .locator(target.priceSelector ?? DEFAULT_PRICE_SELECTOR)
    .first()
    .textContent({ timeout: 5000 })
    .catch(() => null);

  const { amount, currency } = parsePrice(priceText);

  return {
    price: amount,
    currency,
    inStock,
    originalPrice,
    promoLabel,
    campaignLabel,
    imageUrl,
    raw: { priceText },
  };
}
