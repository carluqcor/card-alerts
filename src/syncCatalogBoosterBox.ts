import { crawlBoosterBoxListing } from "./helpers/boosterBoxCategoryCrawler.js";
import { getAllTargetsForSite, insertTargets } from "./helpers/db.js";
import { notifyTelegram } from "./helpers/notify.js";

// Scoped to in-stock, Spanish-language Pokémon products only (per how this URL was chosen) —
// not the full ~302-product/19-page catalog.
const LISTING_URL =
  "https://theboosterbox.es/collections/pokemon?sort_by=most-relevant&filter.p.m.custom.idioma=Espa%C3%B1ol&filter.v.availability=1&filter.v.price.gte=&filter.v.price.lte=";

async function notifyNewProducts(products: { url: string; name: string }[]): Promise<void> {
  if (products.length === 0) return;

  const shown = products.slice(0, 10);
  const lines = [
    `🆕 <b>[Boosterbox] ${products.length} new product${products.length > 1 ? "s" : ""} found</b>`,
    ...shown.map((p) => `• ${p.name}\n${p.url}`),
  ];
  if (products.length > shown.length) {
    lines.push(`…and ${products.length - shown.length} more`);
  }

  await notifyTelegram(lines.join("\n"));
}

// This listing is filtered to "available now" — unlike Carrefour's full category listing, a
// product missing from this crawl just means it's out of stock right now, not that it's been
// delisted. So this only ever adds newly-seen products; it never deactivates anything based on
// listing absence, since that would fire constantly for ordinary stock fluctuations rather than
// real delistings. If a product is genuinely discontinued, deactivate it manually in Supabase.
export async function runSyncCatalogBoosterBox(): Promise<void> {
  const listed = await crawlBoosterBoxListing(LISTING_URL);
  const listingByUrl = new Map(listed.map((p) => [p.url, p.name]));

  const existing = await getAllTargetsForSite("boosterbox");
  const existingByUrl = new Map(existing.map((t) => [t.url, t]));

  const newProducts = [...listingByUrl.entries()]
    .filter(([url]) => !existingByUrl.has(url))
    .map(([url, name]) => ({ url, name }));

  await insertTargets(newProducts.map((p) => ({ site: "boosterbox" as const, url: p.url, name: p.name })));

  console.log(`Catalog sync (Boosterbox): ${listingByUrl.size} listed (available now), ${newProducts.length} new`);

  await notifyNewProducts(newProducts);
}
