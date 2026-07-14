import type { Browser } from "playwright";
import { launchBrowser } from "./browser.js";

const BASE_URL = "https://theboosterbox.es";
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
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForTimeout(2000);

    const cards = await page.$$eval("li.grid__item", (nodes) =>
      nodes.map((card) => {
        const link = card.querySelector("a[href*='/products/']");
        const heading = card.querySelector(".bb-card__title");
        return {
          href: link?.getAttribute("href") ?? null,
          name: heading?.textContent?.trim() ?? null,
        };
      })
    );

    // Shopify only renders a pagination nav when results span more than one page — this
    // listing's filtered view (in-stock, Spanish) currently fits on one page, but this follows
    // rel="next" defensively in case that count ever grows.
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

// Crawls theboosterbox.es's Pokémon collection (scoped to whatever filters the given listingUrl
// already encodes — e.g. in-stock + Spanish-language only, per how this is currently used),
// following pagination if present, deduped by absolute product URL.
export async function crawlBoosterBoxListing(listingUrl: string): Promise<CategoryProduct[]> {
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
