import type { Browser } from "playwright";
import { launchBrowser } from "./browser.js";

const BASE_URL = "https://epichitstore.es";
const MAX_PAGES = 10;

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

    // The product card's own link carries the full product name in its `title` attribute —
    // this theme doesn't use WooCommerce's default `li.product`/`.woocommerce-loop-product__title`
    // markup, so structural card scraping isn't reliable here the way it is on other sites.
    const cards = await page.$$eval("a[href*='/producto/']", (nodes) => {
      const seen = new Set<string>();
      const out: { href: string | null; name: string | null }[] = [];
      for (const node of nodes) {
        const href = node.getAttribute("href");
        if (!href || seen.has(href)) continue;
        seen.add(href);
        out.push({ href, name: node.getAttribute("title") });
      }
      return out;
    });

    const nextHref = await page
      .locator("a.next.page-numbers")
      .first()
      .getAttribute("href")
      .catch(() => null);

    return { cards, nextHref };
  } finally {
    await context.close();
  }
}

// Crawls epichitstore.es's Pokémon category (scoped to whatever filters the given listingUrl
// already encodes, per how this is currently used — though the `stock_status=instock` filter
// itself was confirmed unreliable via the Store API, so the scraper's own per-product check is
// what actually determines real stock, same as this project's other imperfectly-filtered
// listings). Follows pagination defensively even though the current listing fits on one page.
export async function crawlEpicHitStoreListing(listingUrl: string): Promise<CategoryProduct[]> {
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
