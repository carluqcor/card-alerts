import type { Browser } from "playwright";
import { launchBrowser } from "./browser.js";
import { pinSpainStorefront } from "./shopifyLocalization.js";

const BASE_URL = "https://www.pokemillon.com";
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
    await pinSpainStorefront(context, "pokemillon.com");
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForTimeout(2000);

    // Scoped to #product-grid specifically — a site-wide header mega-menu widget (unrelated
    // cross-category "featured" products, e.g. non-Pokémon items) is present on every page
    // including this one, and an unscoped product-link selector picks that up instead of the
    // actual collection grid.
    const cards = await page.locator("#product-grid li.column").evaluateAll((nodes) =>
      nodes.map((card) => {
        const link = card.querySelector("a[href*='/products/']");
        const heading = card.querySelector(".pm-coltabs__title");
        return {
          href: link?.getAttribute("href") ?? null,
          name: heading?.textContent?.trim() ?? null,
        };
      })
    );

    // This listing currently fits on one page, but follows rel="next" defensively in case that
    // count ever grows (same defensive pattern as the other Shopify crawlers here).
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

// Crawls pokemillon.com's Pokémon TCG collection (scoped to whatever filters the given
// listingUrl already encodes — e.g. in-stock only, per how this is currently used), following
// pagination if present, deduped by absolute product URL.
export async function crawlPokemillonListing(listingUrl: string): Promise<CategoryProduct[]> {
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
