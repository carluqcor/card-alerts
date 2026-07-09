import type { Handler } from "@netlify/functions";
import type { Browser } from "playwright-core";
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

// Launching many sequential Chromium instances in one invocation's container exhausts the
// free-tier Lambda's memory (observed: browsers start getting killed mid-navigation after ~5
// launches in one run). So each invocation only processes a small mini-batch, then triggers
// the next one itself before returning — a self-chaining sequence rather than one giant loop.
// trigger-scrape.ts (on its 4-hourly schedule) only ever has to kick off batch 0; this file
// chains through the rest, so a full run of all targets still completes within one 4-hour window.
const MINI_BATCH_SIZE = 5;

interface BatchParams {
  batchIndex: number;
  batchCount: number;
}

function resolveBatchParams(event: { queryStringParameters?: Record<string, string | undefined> | null }, totalTargets: number): BatchParams {
  const q = event.queryStringParameters ?? {};
  const batchCount = q.batchCount != null ? Number(q.batchCount) : Math.max(1, Math.ceil(totalTargets / MINI_BATCH_SIZE));
  const batchIndex = q.batchIndex != null ? Number(q.batchIndex) : 0;
  return { batchIndex, batchCount };
}

async function triggerNextBatch(batchIndex: number, batchCount: number): Promise<void> {
  const baseUrl = process.env.URL;
  if (!baseUrl) throw new Error("Missing URL env var (site's own base address)");
  await fetch(
    `${baseUrl}/.netlify/functions/scrape-background?batchIndex=${batchIndex}&batchCount=${batchCount}`,
    { method: "POST" }
  );
}

export interface PreviousCheck {
  price: number | null;
  in_stock: boolean | null;
  original_price: number | null;
  promo_label: string | null;
}

// If the browser process has already crashed, browser.close() can hang indefinitely waiting
// for a graceful-shutdown acknowledgment that will never arrive — which then hangs the whole
// invocation until Netlify force-kills it near the 15-minute cap (observed: a ~884s duration
// on a batch that should take ~2 minutes). A plain `Browser` from chromium.launch() doesn't
// expose the underlying OS process (only BrowserServer/ElectronApplication do), so we can't
// force-kill it directly — but capping close() with a timeout at least stops one crashed
// browser from stalling the entire invocation and every chained batch after it.
async function closeBrowserSafely(browser: Browser): Promise<void> {
  await Promise.race([
    browser.close().catch(() => {}),
    new Promise<void>((resolve) => setTimeout(resolve, 5000)),
  ]);
}

async function scrapeOneTarget(target: Target): Promise<ScrapeResult> {
  // Each target gets its own browser session — Cloudflare (and likely similar bot
  // protection on other sites) scores multiple navigations in one session as bot
  // behavior and blocks the second one, even with delays in between.
  const browser = await launchBrowser();
  try {
    // Playwright's default headless fingerprint gets served a stripped/challenge page on
    // some sites (no error thrown, just missing data) — a realistic UA avoids that.
    const page = await browser.newPage({
      locale: "es-ES",
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    });
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
    await closeBrowserSafely(browser);
  }
}

export const handler: Handler = async (event) => {
  const allTargets = await getActiveTargets();

  // Local-testing escape hatch: force a single full-catalog run instead of mini-batch chaining.
  const forceAll = process.env.SCRAPE_BATCH_OVERRIDE === "all";
  const { batchIndex, batchCount } = forceAll
    ? { batchIndex: 0, batchCount: 1 }
    : resolveBatchParams(event, allTargets.length);

  // Only the first mini-batch in a chain jitters — chained calls firing seconds apart shouldn't
  // each re-roll a multi-minute delay, that would stretch a 4-hour run across most of the day.
  if (batchIndex === 0) await randomJitter(JITTER_MAX_MINUTES);

  const targets = allTargets.filter((_, i) => i % batchCount === batchIndex);

  console.log(`Batch ${batchIndex + 1}/${batchCount}: ${targets.length} of ${allTargets.length} targets`);

  for (const [index, target] of targets.entries()) {
    if (index > 0) {
      const delayMs = 4000 + Math.floor(Math.random() * 4000);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    console.log(`[${index + 1}/${targets.length}] Scraping ${target.name} (${target.site})...`);

    try {
      const result = await scrapeOneTarget(target);
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

  if (batchIndex + 1 < batchCount) {
    await triggerNextBatch(batchIndex + 1, batchCount);
  }

  return { statusCode: 200, body: "ok" };
};

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
