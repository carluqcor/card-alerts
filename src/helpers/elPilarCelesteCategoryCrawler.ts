import type { Browser } from "playwright";
import { launchBrowser } from "./browser.js";

const BASE_URL = "https://elpilarceleste.es";
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
    // Cloudflare's "checking your browser" JS challenge needs real time to clear — a shorter
    // wait was observed still showing the interstitial page with zero products found. The
    // challenge page itself auto-redirects to the real page once it passes, which can land
    // mid-wait and destroy the execution context out from under a read that started just
    // before it — retrying once after the dust settles works around that race (waiting for
    // "load" beforehand still isn't enough: it can resolve against the very context that's
    // about to be torn down).
    await page.waitForTimeout(6000);

    // WoodMart theme markup — a generic product-link selector also picks up "quick view" and
    // wishlist icon links that share the same href, so this scopes to the actual title link.
    const extractCards = () =>
      page.locator(".wd-product-wrapper").evaluateAll((nodes) =>
        nodes.map((card) => {
          const heading = card.querySelector("h3.wd-entities-title a");
          return {
            href: heading?.getAttribute("href") ?? null,
            name: heading?.textContent?.trim() ?? null,
          };
        })
      );

    let cards: RawCard[];
    try {
      cards = await extractCards();
    } catch {
      await page.waitForTimeout(3000);
      cards = await extractCards();
    }

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

// Crawls elpilarceleste.es's Pokémon TCG category (scoped to whatever filters the given
// listingUrl already encodes, per how this is currently used), following pagination, deduped by
// absolute product URL.
export async function crawlElPilarCelesteListing(listingUrl: string): Promise<CategoryProduct[]> {
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
