import { crawlCardzoneListing } from "./helpers/cardzoneCategoryCrawler.js";
import { getAllTargetsForSite, insertTargets } from "./helpers/db.js";
import { notifyTelegram } from "./helpers/notify.js";

// Scoped to in-stock, Spanish-language Pokémon TCG products only (per how this URL was chosen).
const LISTING_URL =
  "https://cardzone.es/collections/cartas-pokemon-tcg?filter.v.availability=1&filter.p.m.custom.idioma=Espa%C3%B1ol";

async function notifyNewProducts(products: { url: string; name: string }[]): Promise<void> {
  if (products.length === 0) return;

  const shown = products.slice(0, 10);
  const lines = [
    `🆕 <b>[Cardzone] ${products.length} new product${products.length > 1 ? "s" : ""} found</b>`,
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
export async function runSyncCatalogCardzone(): Promise<void> {
  const listed = await crawlCardzoneListing(LISTING_URL);
  const listingByUrl = new Map(listed.map((p) => [p.url, p.name]));

  const existing = await getAllTargetsForSite("cardzone");
  const existingByUrl = new Map(existing.map((t) => [t.url, t]));

  const newProducts = [...listingByUrl.entries()]
    .filter(([url]) => !existingByUrl.has(url))
    .map(([url, name]) => ({ url, name }));

  await insertTargets(newProducts.map((p) => ({ site: "cardzone" as const, url: p.url, name: p.name })));

  console.log(`Catalog sync (Cardzone): ${listingByUrl.size} listed (available now), ${newProducts.length} new`);

  await notifyNewProducts(newProducts);
}
