import { crawlEpicHitStoreListing } from "./helpers/epicHitStoreCategoryCrawler.js";
import { getAllTargetsForSite, insertTargets } from "./helpers/db.js";
import { notifyTelegram } from "./helpers/notify.js";

// Filtered to Spanish-language Pokémon products, "instock" per the site's own (imperfect) filter
// — this listing is only used for discovery; the scraper's own Store API check is what actually
// determines real stock on each check (see src/scrapers/epichitstore.ts).
const LISTING_URL = "https://epichitstore.es/categoria/pokemon/?stock_status=instock&filter_idioma=espanol&per_page=-1";

async function notifyNewProducts(products: { url: string; name: string }[]): Promise<void> {
  if (products.length === 0) return;

  const shown = products.slice(0, 10);
  const lines = [
    `🆕 <b>[EpicHitStore] ${products.length} new product${products.length > 1 ? "s" : ""} found</b>`,
    ...shown.map((p) => `• ${p.name}\n${p.url}`),
  ];
  if (products.length > shown.length) {
    lines.push(`…and ${products.length - shown.length} more`);
  }

  await notifyTelegram(lines.join("\n"));
}

// This only ever adds newly-seen products; it never deactivates anything based on listing
// absence, since the "instock" filter is confirmed unreliable (products missing from this crawl
// aren't necessarily delisted, and products present in it aren't necessarily really in stock —
// see src/scrapers/epichitstore.ts for how real stock is actually determined).
export async function runSyncCatalogEpicHitStore(): Promise<void> {
  const listed = await crawlEpicHitStoreListing(LISTING_URL);
  const listingByUrl = new Map(listed.map((p) => [p.url, p.name]));

  const existing = await getAllTargetsForSite("epichitstore");
  const existingByUrl = new Map(existing.map((t) => [t.url, t]));

  const newProducts = [...listingByUrl.entries()]
    .filter(([url]) => !existingByUrl.has(url))
    .map(([url, name]) => ({ url, name }));

  await insertTargets(newProducts.map((p) => ({ site: "epichitstore" as const, url: p.url, name: p.name })));

  console.log(`Catalog sync (EpicHitStore): ${listingByUrl.size} listed, ${newProducts.length} new`);

  await notifyNewProducts(newProducts);
}
