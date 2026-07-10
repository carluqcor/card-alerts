import type { Browser } from "playwright";
import { launchBrowser } from "./browser.js";

const BASE_URL = "https://www.carrefour.es";
const PAGE_SIZE = 24;
const MAX_PAGES = 20;
const MAX_ATTEMPTS_PER_PAGE = 3;

interface RawCard {
  sellerId: string | null;
  href: string | null;
  name: string | null;
}

interface PageResult {
  cards: RawCard[];
  total: number | null;
}

export interface CategoryProduct {
  url: string;
  name: string;
}

async function loadOnePage(browser: Browser, url: string): Promise<PageResult> {
  const page = await browser.newPage({
    locale: "es-ES",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  });

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForTimeout(1500);

  // Ground truth for how many products this category actually has, e.g. "1 - 24 de 65 productos".
  // Used to detect an incomplete lazy-load rather than trusting a fixed scroll-iteration count.
  const totalText = await page
    .locator(".pagination__results")
    .first()
    .textContent({ timeout: 5000 })
    .catch(() => null);
  const total = totalText ? Number(totalText.match(/de\s+(\d+)\s+productos/i)?.[1] ?? "") || null : null;

  // Product cards lazy-load on real scroll events; scrollTo() alone doesn't trigger it. Scroll
  // until the card count stops growing for two consecutive checks, rather than a fixed count —
  // a fixed count previously stopped early on slower loads, under-reporting real page contents.
  let lastCount = -1;
  let stableRounds = 0;
  for (let i = 0; i < 30 && stableRounds < 2; i++) {
    await page.mouse.wheel(0, 1500);
    await page.waitForTimeout(500);
    const count = await page.locator("div.product-card").count();
    stableRounds = count === lastCount ? stableRounds + 1 : 0;
    lastCount = count;
    if (count >= PAGE_SIZE) break;
  }

  const cards = await page.$$eval("div.product-card", (nodes) =>
    nodes.map((card) => {
      const link = card.querySelector("a.product-card__title-link");
      return {
        sellerId: card.getAttribute("seller_id"),
        href: link?.getAttribute("href") ?? null,
        name: link?.textContent?.trim() ?? null,
      };
    })
  );

  return { cards, total };
}

// Cloudflare's bot scoring appears to key off session-level behavior: a single navigation
// per browser session consistently gets through, but a second navigation in the same
// session/page reliably gets challenge-blocked. So each page load gets its own fresh
// browser instance rather than reusing one across the pagination loop.
async function collectPage(url: string, expectedCount: number): Promise<PageResult> {
  let lastResult: PageResult = { cards: [], total: null };

  for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_PAGE; attempt++) {
    const browser = await launchBrowser();
    try {
      lastResult = await loadOnePage(browser, url);
    } finally {
      await browser.close();
    }

    if (lastResult.cards.length >= expectedCount) return lastResult;

    // Fewer cards than expected — likely an incomplete lazy-load, not a genuinely short page.
    // Retry with a fresh browser session rather than silently accepting a partial result.
    if (attempt < MAX_ATTEMPTS_PER_PAGE - 1) {
      await new Promise((resolve) => setTimeout(resolve, 3000 + Math.floor(Math.random() * 3000)));
    }
  }

  return lastResult;
}

function pageUrlFor(categoryUrl: string, offset: number): string {
  return offset === 0 ? categoryUrl : `${categoryUrl}?offset=${offset}`;
}

function expectedCountFor(knownTotal: number | null, collected: number): number {
  const remaining = knownTotal != null ? knownTotal - collected : PAGE_SIZE;
  return Math.min(PAGE_SIZE, Math.max(remaining, 1));
}

async function delayBetweenPages(): Promise<void> {
  const delayMs = 6000 + Math.floor(Math.random() * 6000);
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

// Whether the crawl should stop after this page. Without a known total, a short/empty page is
// our only "end of results" signal, so the old heuristic applies. With a known total, only trust
// it fully reached — a short or empty page despite retries is a single bad/blocked page, not
// real end-of-results, so we keep going rather than truncating the whole crawl over it.
function shouldStopCrawl(cardsInPage: number, totalCollected: number, knownTotal: number | null): boolean {
  if (knownTotal != null) return totalCollected >= knownTotal;
  return cardsInPage < PAGE_SIZE;
}

// Crawls every page of a Carrefour category listing and returns the products actually sold by
// Carrefour itself (seller_id === "0"), deduped by absolute URL. Marketplace-seller offers are
// filtered out even if the category URL wasn't already scoped to "vendido por Carrefour".
export async function crawlCarrefourCategory(categoryUrl: string): Promise<CategoryProduct[]> {
  const all: RawCard[] = [];
  let knownTotal: number | null = null;

  for (let i = 0; i < MAX_PAGES; i++) {
    if (i > 0) await delayBetweenPages();

    const pageUrl = pageUrlFor(categoryUrl, i * PAGE_SIZE);
    const { cards, total } = await collectPage(pageUrl, expectedCountFor(knownTotal, all.length));
    if (total != null) knownTotal = total;

    all.push(...cards);

    if (shouldStopCrawl(cards.length, all.length, knownTotal)) break;
  }

  if (knownTotal != null && all.length < knownTotal) {
    console.error(
      `crawlCarrefourCategory: expected ${knownTotal} products but only collected ${all.length} — ` +
        `some pages may have under-reported after retries.`
    );
  }

  const carrefourSold = all.filter((i) => i.sellerId === "0" && i.href && i.name);
  const unique = new Map<string, string>();
  for (const item of carrefourSold) {
    const absoluteUrl = new URL(item.href!, BASE_URL).toString();
    unique.set(absoluteUrl, item.name!);
  }

  return [...unique.entries()].map(([url, name]) => ({ url, name }));
}
