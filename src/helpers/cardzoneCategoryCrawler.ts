import type { Browser } from "playwright";
import { launchBrowser } from "./browser.js";
import { pinSpainStorefront } from "./shopifyLocalization.js";

const BASE_URL = "https://cardzone.es";
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
    await pinSpainStorefront(context, "cardzone.es");
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForTimeout(2000);

    const cards = await page.$$eval("a[href*='/products/']", (els) => {
      // Each product has two anchors pointing at the same URL: one wraps the card image (empty
      // text) and one wraps the title text directly as its own textContent (class
      // "product-title", no separate heading element to search for) — keep whichever one
      // actually has text for a given href.
      const byHref = new Map<string, string | null>();
      for (const el of els) {
        const href = el.getAttribute("href")?.split("?")[0] ?? null;
        if (!href) continue;
        const text = el.textContent?.trim() || null;
        if (text && !byHref.get(href)) byHref.set(href, text);
        else if (!byHref.has(href)) byHref.set(href, null);
      }
      const out: { href: string | null; name: string | null }[] = [];
      for (const [href, name] of byHref) out.push({ href, name });
      return out;
    });

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

// Crawls cardzone.es's Pokémon TCG collection (scoped to whatever filters the given listingUrl
// already encodes — e.g. in-stock, Spanish-language only, per how this is currently used),
// following pagination, deduped by absolute product URL.
export async function crawlCardzoneListing(listingUrl: string): Promise<CategoryProduct[]> {
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
