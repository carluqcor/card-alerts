import type { Browser } from "playwright";
import { launchBrowser } from "./browser.js";
import { pinSpainStorefront } from "./shopifyLocalization.js";

const BASE_URL = "https://kamehousecards.com";
const MAX_PAGES = 20;

export interface CategoryProduct {
  url: string;
  name: string;
}

interface RawCard {
  href: string | null;
  name: string | null;
}

async function loadOnePage(browser: Browser, url: string, pageNumber: number): Promise<RawCard[]> {
  const context = await browser.newContext({
    locale: "es-ES",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  });
  try {
    await pinSpainStorefront(context, "kamehousecards.com");
    const page = await context.newPage();
    const pagedUrl = new URL(url);
    pagedUrl.searchParams.set("page", String(pageNumber));

    try {
      await page.goto(pagedUrl.toString(), { waitUntil: "domcontentloaded", timeout: 45_000 });
    } catch (err) {
      // Pages past the real end of the catalog have been observed timing out outright rather
      // than loading an empty grid (seen consistently around page 3+) — treated the same as an
      // empty page (stop paginating) rather than failing the whole crawl over it.
      console.warn(`kamehousecards page ${pageNumber} failed to load, stopping pagination: ${(err as Error).message}`);
      return [];
    }
    await page.waitForTimeout(2000);

    // Scoped to .product-grid — an unscoped product-link selector also picks up unrelated
    // "recently viewed"/predictive-search cards present in the DOM site-wide.
    return await page.locator(".product-grid").locator("a[href*='/products/']").evaluateAll((nodes) =>
      nodes.map((node) => {
        const card = node.closest("product-card") ?? node.closest("li");
        const heading = card?.querySelector("[class*='title'], h3, h2");
        return {
          href: node.getAttribute("href"),
          name: heading?.textContent?.trim() ?? null,
        };
      })
    );
  } finally {
    await context.close();
  }
}

// Crawls kamehousecards.com's Pokémon collection (scoped to whatever filters the given
// listingUrl already encodes — e.g. in-stock only, per how this is currently used). This theme
// never renders a rel="next" link regardless of page count, so pagination is driven by
// incrementing ?page= until a page comes back with no products, rather than following a link.
export async function crawlKameHouseCardsListing(listingUrl: string): Promise<CategoryProduct[]> {
  const browser = await launchBrowser();
  try {
    const all: RawCard[] = [];

    for (let pageNumber = 1; pageNumber <= MAX_PAGES; pageNumber++) {
      const cards = await loadOnePage(browser, listingUrl, pageNumber);
      if (cards.length === 0) break;
      all.push(...cards);
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
