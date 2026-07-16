import type { BrowserContext, Page } from "playwright";
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

// Fallback list of the expansion tabs known at the time of writing (page IDs collected by
// manually browsing the hub). Used only when the hub page's nav doesn't fully render — observed
// in CI, where it comes back with just the top-level tabs and none of the expansion submenu
// items, most likely because Amazon serves a reduced/less-personalized nav to a datacenter IP
// it has no trust history with (unlike a residential IP), not something a longer wait fixes.
// This list needs a manual add whenever Pokémon ships a new expansion AND the hub page also
// isn't discovering it live — until then, this keeps catalog sync working at all.
const KNOWN_EXPANSION_URLS = [
  "87DE6119-0498-4809-A38E-632C0686D652", // Oscuridad Absoluta
  "B0A2BFA2-57C8-44E8-8B2E-054CB7E0F131", // Caos Creciente
  "0D587C3F-DB84-43ED-9385-E7C0D5CB91E8", // Equilibrio Perfecto
  "1AB36771-8713-44B9-9DBC-15A7ED12349D", // Héroes Ascendentes
  "40534B2C-819F-4E95-86AD-5BD244588925", // Fuegos Fantasmales
  "3F62C964-56AD-4356-A476-87C9C09D20A6", // Megaevolución
  "8F55DF02-3CE6-44B8-A320-957587FD9A4B", // Evoluciones Prismáticas
].map((id) => `${BASE_URL}/stores/page/${id}`);

export interface StoreProduct {
  url: string;
  name: string;
}

// The store page's nav renders incrementally — top-level tabs are in the initial HTML, but the
// submenu items (the expansion tabs this crawler actually needs) attach some seconds later via
// a separate script. A fixed short wait was observed passing locally (where it happens to
// finish quickly) but leaving only the top-level tabs present on a slower CI run — so this polls
// until the link count stops growing instead of guessing a fixed delay, same approach already
// used by the Carrefour category crawler for its own lazy-loaded cards.
async function waitForStableLinkCount(page: Page, selector: string): Promise<void> {
  let lastCount = -1;
  let stableRounds = 0;
  for (let i = 0; i < 20 && stableRounds < 3; i++) {
    await page.waitForTimeout(500);
    const count = await page.locator(selector).count();
    stableRounds = count === lastCount ? stableRounds + 1 : 0;
    lastCount = count;
  }
}

async function findExpansionPageUrls(context: BrowserContext): Promise<string[]> {
  const page = await context.newPage();
  try {
    await page.goto(EXPANSIONS_HUB_URL, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await waitForStableLinkCount(page, "a[href*='/stores/page/']");

    const navLinks = await page.$$eval("a", (els) =>
      els
        .map((e) => ({ text: e.textContent?.replace(/\s+/g, " ").trim() ?? "", href: e.getAttribute("href") }))
        .filter((e) => e.href?.includes("/stores/page/"))
    );

    const startIndex = navLinks.findIndex((l) => l.text === EXPANSION_SECTION_START);
    const endIndex = navLinks.findIndex((l) => l.text === EXPANSION_SECTION_END);
    if (startIndex < 0 || endIndex < 0 || endIndex <= startIndex) {
      // Couldn't find the expected nav markers at all — genuinely no way to tell an empty/
      // redesigned page from a bot-check/blocked one without this, since it runs unattended on CI.
      const title = await page.title().catch(() => "<title read failed>");
      const bodySnippet = await page
        .locator("body")
        .innerText()
        .then((t) => t.replace(/\s+/g, " ").trim().slice(0, 300))
        .catch(() => "<body read failed>");
      console.error(
        `findExpansionPageUrls: nav markers not found (${navLinks.length} store-page links seen). ` +
          `title="${title}" finalUrl="${page.url()}" bodySnippet="${bodySnippet}"`
      );
      return [];
    }

    const tabs = navLinks.slice(startIndex + 1, endIndex);
    const urls = new Set(tabs.map((l) => new URL(l.href!, BASE_URL).toString().split("?")[0]));
    // The hub's own link sometimes reappears inside this slice (e.g. a "back to top" link within
    // the submenu) — it has no products of its own, so crawling it just wastes a request.
    urls.delete(EXPANSIONS_HUB_URL);
    return [...urls];
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

    if (byAsin.size === 0) {
      const title = await page.title().catch(() => "<title read failed>");
      const bodySnippet = await page
        .locator("body")
        .innerText()
        .then((t) => t.replace(/\s+/g, " ").trim().slice(0, 300))
        .catch(() => "<body read failed>");
      console.error(
        `crawlOneExpansionPage: 0 products found for ${url}. title="${title}" finalUrl="${page.url()}" bodySnippet="${bodySnippet}"`
      );
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
      const discovered = await findExpansionPageUrls(context);
      const expansionUrls = discovered.length > 0 ? discovered : KNOWN_EXPANSION_URLS;
      if (discovered.length === 0) {
        console.warn(
          `crawlAmazonStoreByExpansion: hub page nav didn't yield any expansion tabs, falling back to ${KNOWN_EXPANSION_URLS.length} known tabs`
        );
      }

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
