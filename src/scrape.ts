import type { Browser } from "playwright";
import { launchBrowser } from "./helpers/browser.js";
import { randomJitter } from "./helpers/jitter.js";
import {
  getActiveTargets,
  getLastCheck,
  getMinPrice,
  insertCheck,
  updateTargetImage,
  type Target,
} from "./helpers/db.js";
import { notifyTelegram } from "./helpers/notify.js";
import { scrapeBySite, type ScrapeResult } from "./scrapers/index.js";

const JITTER_MAX_MINUTES = Number(process.env.JITTER_MAX_MINUTES ?? 20);

export interface PreviousCheck {
  price: number | null;
  in_stock: boolean | null;
  original_price: number | null;
  promo_label: string | null;
}

// A crashed browser/context's close() can hang indefinitely waiting for a shutdown
// acknowledgment that never arrives — capping it with a timeout keeps one bad target
// from stalling the whole run.
async function closeSafely(closable: { close(): Promise<void> }): Promise<void> {
  await Promise.race([
    closable.close().catch(() => {}),
    new Promise<void>((resolve) => setTimeout(resolve, 5000)),
  ]);
}

async function scrapeOneTarget(browser: Browser, target: Target): Promise<ScrapeResult> {
  // Cloudflare (and likely similar bot protection on other sites) scores multiple
  // navigations sharing cookies/storage as bot behavior — a fresh incognito context per
  // target dodges that without paying the cost of relaunching a whole Chromium process
  // each time (confirmed by testing: 10 back-to-back fresh-context navigations against a
  // real product page all succeeded, each taking ~2s instead of the several extra seconds
  // a full browser relaunch adds).
  const context = await browser.newContext({
    locale: "es-ES",
    // Playwright's default headless fingerprint gets served a stripped/challenge page on
    // some sites (no error thrown, just missing data) — a realistic UA avoids that.
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  });
  try {
    const page = await context.newPage();
    const scraper = scrapeBySite(target.site);
    return await scraper(page, {
      id: target.id,
      site: target.site,
      url: target.url,
      name: target.name,
      priceSelector: target.price_selector ?? undefined,
      stockSelector: target.stock_selector ?? undefined,
      existingImageUrl: target.image_url,
    });
  } finally {
    await closeSafely(context);
  }
}

export async function runScrape(): Promise<void> {
  await randomJitter(JITTER_MAX_MINUTES);

  const targets = await getActiveTargets();
  console.log(`Scraping ${targets.length} targets`);

  let browser = await launchBrowser();

  for (const [index, target] of targets.entries()) {
    if (index > 0) {
      const delayMs = 4000 + Math.floor(Math.random() * 4000);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    console.log(`[${index + 1}/${targets.length}] Scraping ${target.name} (${target.site})...`);

    try {
      // Contexts are isolated from each other, so one bad page shouldn't take down the
      // shared browser — but if it somehow does, relaunch rather than losing the rest of the run.
      if (!browser.isConnected()) {
        console.warn("  Shared browser disconnected, relaunching...");
        browser = await launchBrowser();
      }

      const result = await scrapeOneTarget(browser, target);
      const previous: PreviousCheck | null = await getLastCheck(target.id);
      // Fetched before insertCheck so it reflects history strictly before this check.
      const historicalMinPrice = await getMinPrice(target.id);

      await insertCheck({
        target_id: target.id,
        price: result.price,
        currency: result.currency,
        in_stock: result.inStock,
        original_price: result.originalPrice ?? null,
        promo_label: result.promoLabel ?? null,
        raw: result.raw,
      });

      if (result.imageUrl && result.imageUrl !== target.image_url) {
        await updateTargetImage(target.id, result.imageUrl);
      }

      console.log(
        `  -> price=${result.price ?? "?"} ${result.currency ?? ""} in_stock=${result.inStock}` +
          (result.promoLabel ? ` promo="${result.promoLabel}"` : "")
      );

      await maybeNotify(target, previous, result, historicalMinPrice);
    } catch (err) {
      console.error(`  -> FAILED: ${target.name} (${target.site}):`, err);
    }
  }

  await closeSafely(browser);
}

export interface NotifyEvents {
  wentInStock: boolean;
  wentOutOfStock: boolean;
  newOffer: boolean;
  priceDropped: boolean;
  priceIncreased: boolean;
  allTimeLow: boolean;
}

// Each of these (except the all-time-low) compares only against the immediately previous
// check, so it fires exactly once per transition (e.g. 15€ -> 13€ notifies, staying at 13€
// across later checks does not, a further drop to 12€ notifies again) rather than repeating
// on every check. historicalMinPrice is null on a target's first-ever check (nothing to beat
// yet), so that case is correctly excluded from allTimeLow rather than treated as a record.
export function detectNotifyEvents(
  previous: PreviousCheck | null,
  result: ScrapeResult,
  historicalMinPrice: number | null
): NotifyEvents {
  const inStockNow = result.inStock === true;
  const hadOffer = Boolean(previous?.promo_label || previous?.original_price);
  const hasOffer = Boolean(result.promoLabel || result.originalPrice);
  const previousPrice = previous?.price;

  return {
    wentInStock: previous?.in_stock === false && inStockNow,
    wentOutOfStock: previous?.in_stock === true && result.inStock === false,
    newOffer: inStockNow && !hadOffer && hasOffer,
    priceDropped: inStockNow && previousPrice != null && result.price != null && result.price < previousPrice,
    priceIncreased: inStockNow && previousPrice != null && result.price != null && result.price > previousPrice,
    allTimeLow:
      inStockNow && result.price != null && historicalMinPrice != null && result.price < historicalMinPrice,
  };
}

export function formatNotifyLines(
  events: NotifyEvents,
  previous: PreviousCheck | null,
  result: ScrapeResult
): string[] {
  const lines: string[] = [];
  if (events.wentInStock) lines.push("✅ Back in stock");
  if (events.wentOutOfStock) lines.push("❌ Out of stock");
  if (events.newOffer) {
    const suffix = result.promoLabel ? `: ${result.promoLabel}` : "";
    lines.push(`🏷️ New offer${suffix}`);
  }
  if (events.priceDropped) lines.push(`📉 Price dropped: ${previous!.price} € → ${result.price} €`);
  if (events.priceIncreased) lines.push(`📈 Price increased: ${previous!.price} € → ${result.price} €`);
  if (events.allTimeLow) lines.push(`🔥 New all-time low: ${result.price} €`);
  return lines;
}

async function maybeNotify(
  target: Target,
  previous: PreviousCheck | null,
  result: ScrapeResult,
  historicalMinPrice: number | null
): Promise<void> {
  const events = detectNotifyEvents(previous, result, historicalMinPrice);
  const eventLines = formatNotifyLines(events, previous, result);
  if (eventLines.length === 0) return;

  const lines = [`<b>${target.name}</b>`, target.url, ...eventLines];
  await notifyTelegram(lines.join("\n"));
}
