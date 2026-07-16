import type { Browser } from "playwright";
import { launchBrowser } from "./browser.js";
import { pinSpainStorefront } from "./shopifyLocalization.js";

const BASE_URL = "https://todohits.com";
const MAX_PAGES = 20;

export interface CategoryProduct {
  url: string;
  name: string;
}

interface RawCard {
  href: string | null;
  name: string | null;
}

async function loadOnePage(browser: Browser, url: string): Promise<{ cards: RawCard[]; nextHref: string | null }> {
  const context = await browser.newContext({
    locale: "es-ES",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  });
  try {
    await pinSpainStorefront(context, "todohits.com");
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForTimeout(2000);

    const cards = await page.$$eval(".product-card", (nodes) =>
      nodes.map((card) => {
        // The card's own invisible overlay link carries the full product name in its
        // aria-label — cleaner than a separate title element lookup.
        const link = card.querySelector(".product-card-link");
        return {
          href: link?.getAttribute("href") ?? null,
          name: link?.getAttribute("aria-label") ?? null,
        };
      })
    );

    // This listing genuinely spans multiple pages (unlike theboosterbox.es's single-page view),
    // so following rel="next" here is load-bearing, not just defensive.
    const nextHref = await page
      .locator("a[rel='next']")
      .first()
      .getAttribute("href")
      .catch(() => null);

    return { cards, nextHref };
  } finally {
    await context.close();
  }
}

// Crawls todohits.com's Pokémon collection (scoped to whatever filters the given listingUrl
// already encodes — e.g. in-stock + Spanish-language only, per how this is currently used),
// following pagination, deduped by absolute product URL.
export async function crawlTodoHitsListing(listingUrl: string): Promise<CategoryProduct[]> {
  const browser = await launchBrowser();
  try {
    const all: RawCard[] = [];
    let nextUrl: string | null = listingUrl;

    for (let i = 0; i < MAX_PAGES && nextUrl; i++) {
      const { cards, nextHref } = await loadOnePage(browser, nextUrl);
      all.push(...cards);
      nextUrl = nextHref ? new URL(nextHref, BASE_URL).toString() : null;
    }

    const unique = new Map<string, string>();
    for (const card of all) {
      if (!card.href || !card.name) continue;
      const absoluteUrl = new URL(card.href, BASE_URL).toString().split("?")[0];
      unique.set(absoluteUrl, card.name);
    }

    return [...unique.entries()].map(([url, name]) => ({ url, name }));
  } finally {
    await browser.close();
  }
}
