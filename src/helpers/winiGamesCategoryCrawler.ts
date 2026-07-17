import type { Browser } from "playwright";
import { launchBrowser } from "./browser.js";
import { pinSpainStorefront } from "./shopifyLocalization.js";

const BASE_URL = "https://hkbens-tr.myshopify.com";
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
    await pinSpainStorefront(context, "hkbens-tr.myshopify.com");
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForTimeout(2000);

    const cards = await page.$$eval("li.grid__item", (nodes) =>
      nodes.map((card) => {
        const link = card.querySelector("a[href*='/products/']");
        const heading = card.querySelector(".card__heading");
        return {
          href: link?.getAttribute("href") ?? null,
          name: heading?.textContent?.trim() ?? null,
        };
      })
    );

    // This listing currently fits on one page, but follows rel="next" defensively in case that
    // count ever grows (same defensive pattern as theboosterbox.es's crawler).
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

// Crawls hkbens-tr.myshopify.com's Pokémon TCG collection (scoped to whatever filters the given
// listingUrl already encodes — e.g. in-stock only, per how this is currently used), following
// pagination if present, deduped by absolute product URL.
export async function crawlWiniGamesListing(listingUrl: string): Promise<CategoryProduct[]> {
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
