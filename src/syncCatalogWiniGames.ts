import { crawlWiniGamesListing } from "./helpers/winiGamesCategoryCrawler.js";
import { getAllTargetsForSite, insertTargets } from "./helpers/db.js";
import { notifyTelegram } from "./helpers/notify.js";

// Scoped to in-stock Pokémon TCG products only (per how this URL was chosen).
const LISTING_URL =
  "https://hkbens-tr.myshopify.com/collections/pokemon-tcg?filter.v.availability=1&filter.v.price.gte=&filter.v.price.lte=&sort_by=best-selling";

async function notifyNewProducts(products: { url: string; name: string }[]): Promise<void> {
  if (products.length === 0) return;

  const shown = products.slice(0, 10);
  const lines = [
    `🆕 <b>[WiniGames] ${products.length} new product${products.length > 1 ? "s" : ""} found</b>`,
    ...shown.map((p) => `• ${p.name}\n${p.url}`),
  ];
  if (products.length > shown.length) {
    lines.push(`…and ${products.length - shown.length} more`);
  }

  await notifyTelegram(lines.join("\n"));
}

// This listing is filtered to "available now" — a product missing from this crawl just means
// it's out of stock right now, not that it's been delisted (same reasoning as the other Shopify
// sites' sync modules). So this only ever adds newly-seen products; it never deactivates
// anything based on listing absence.
export async function runSyncCatalogWiniGames(): Promise<void> {
  const listed = await crawlWiniGamesListing(LISTING_URL);
  const listingByUrl = new Map(listed.map((p) => [p.url, p.name]));

  const existing = await getAllTargetsForSite("winigames");
  const existingByUrl = new Map(existing.map((t) => [t.url, t]));

  const newProducts = [...listingByUrl.entries()]
    .filter(([url]) => !existingByUrl.has(url))
    .map(([url, name]) => ({ url, name }));

  await insertTargets(newProducts.map((p) => ({ site: "winigames" as const, url: p.url, name: p.name })));

  console.log(`Catalog sync (WiniGames): ${listingByUrl.size} listed (available now), ${newProducts.length} new`);

  await notifyNewProducts(newProducts);
}
