import type { BrowserContext } from "playwright";
import { launchBrowser } from "./browser.js";

const BASE_URL = "https://www.amazon.es";
// The "Comprar por expansión" tab of the official Pokémon TCG brand store — a stable page ID
// that works without the ephemeral tracking query params (ingress/visitId/etc.) a shared link
// carries.
const EXPANSIONS_HUB_URL = "https://www.amazon.es/stores/page/5F03A804-FE47-4B0C-8D2A-7C6768C9D5F2";
// The store's full nav mixes "by expansion" tabs (Caos Creciente, Héroes Ascendentes, ...) with
// unrelated groupings ("by product type": Sobres de mejora, Latas, ...). Both sections start
// right after their own header link in nav order, so slicing between these two header labels
// isolates just the expansion tabs — new sets add tabs to this same slice automatically, so
// nothing here needs updating when Pokémon releases a new expansion.
const EXPANSION_SECTION_START = "Comprar por expansión";
const EXPANSION_SECTION_END = "Comprar por producto";

export interface StoreProduct {
  url: string;
  name: string;
}

async function findExpansionPageUrls(context: BrowserContext): Promise<string[]> {
  const page = await context.newPage();
  try {
    await page.goto(EXPANSIONS_HUB_URL, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForTimeout(2500);

    const navLinks = await page.$$eval("a", (els) =>
      els
        .map((e) => ({ text: e.textContent?.replace(/\s+/g, " ").trim() ?? "", href: e.getAttribute("href") }))
        .filter((e) => e.href?.includes("/stores/page/"))
    );

    const startIndex = navLinks.findIndex((l) => l.text === EXPANSION_SECTION_START);
    const endIndex = navLinks.findIndex((l) => l.text === EXPANSION_SECTION_END);
    if (startIndex < 0 || endIndex < 0 || endIndex <= startIndex) return [];

    const tabs = navLinks.slice(startIndex + 1, endIndex);
    return [...new Set(tabs.map((l) => new URL(l.href!, BASE_URL).toString().split("?")[0]))];
  } finally {
    await page.close();
  }
}

async function crawlOneExpansionPage(context: BrowserContext, url: string): Promise<StoreProduct[]> {
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForTimeout(2500);
    // Store pages render their product grid/carousel lazily as you scroll — a few scrolls
    // surface everything without needing to reverse-engineer each layout's own pagination.
    for (let i = 0; i < 4; i++) {
      await page.mouse.wheel(0, 3000);
      await page.waitForTimeout(600);
    }

    const entries = await page.$$eval("a[href*='/dp/']", (els) =>
      els.map((e) => ({ href: e.getAttribute("href"), title: e.getAttribute("title") }))
    );

    const byAsin = new Map<string, string>();
    for (const entry of entries) {
      const asin = entry.href?.match(/\/dp\/([A-Z0-9]{10})/)?.[1];
      if (!asin || byAsin.has(asin)) continue;
      // Each product card also wraps its star-rating in an anchor pointing at the same /dp/
      // URL, whose title is the rating text ("4,4 de 5 estrellas") rather than the product
      // name — skip those in favor of the card's actual title-bearing anchor.
      if (!entry.title || /\d de 5 estrellas/i.test(entry.title)) continue;
      byAsin.set(asin, entry.title.trim());
    }

    return [...byAsin.entries()].map(([asin, name]) => ({ url: `${BASE_URL}/dp/${asin}`, name }));
  } finally {
    await page.close();
  }
}

// Discovers the Pokémon TCG Amazon.es catalog by walking the brand store's "Comprar por
// expansión" tabs (one per set release) instead of maintaining a hand-curated ASIN list —
// mirrors how the other sites' catalogs are kept in sync via a live listing page.
export async function crawlAmazonStoreByExpansion(): Promise<StoreProduct[]> {
  const browser = await launchBrowser();
  try {
    const context = await browser.newContext({
      locale: "es-ES",
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    });
    try {
      const expansionUrls = await findExpansionPageUrls(context);

      const byUrl = new Map<string, string>();
      for (const [index, expansionUrl] of expansionUrls.entries()) {
        if (index > 0) {
          await new Promise((resolve) => setTimeout(resolve, 1500 + Math.floor(Math.random() * 1500)));
        }
        const products = await crawlOneExpansionPage(context, expansionUrl);
        for (const p of products) byUrl.set(p.url, p.name);
      }

      return [...byUrl.entries()].map(([url, name]) => ({ url, name }));
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }
}
