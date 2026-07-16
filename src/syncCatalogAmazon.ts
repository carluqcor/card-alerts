import { crawlAmazonStoreByExpansion } from "./helpers/amazonStoreCrawler.js";
import { getAllTargetsForSite, insertTargets } from "./helpers/db.js";
import { notifyTelegram } from "./helpers/notify.js";

async function notifyNewProducts(products: { url: string; name: string }[]): Promise<void> {
  if (products.length === 0) return;

  const shown = products.slice(0, 10);
  const lines = [
    `🆕 <b>[Amazon] ${products.length} new product${products.length > 1 ? "s" : ""} found</b>`,
    ...shown.map((p) => `• ${p.name}\n${p.url}`),
  ];
  if (products.length > shown.length) {
    lines.push(`…and ${products.length - shown.length} more`);
  }

  await notifyTelegram(lines.join("\n"));
}

// The store's "by expansion" tabs only cover 22 of the ~57 originally-seeded products (the rest
// live under other store tabs not crawled here) — so, same reasoning as the other sites, this
// only ever adds newly-seen products and never deactivates anything based on tab absence.
export async function runSyncCatalogAmazon(): Promise<void> {
  const listed = await crawlAmazonStoreByExpansion();
  const listingByUrl = new Map(listed.map((p) => [p.url, p.name]));

  const existing = await getAllTargetsForSite("amazon");
  const existingByUrl = new Map(existing.map((t) => [t.url, t]));

  const newProducts = [...listingByUrl.entries()]
    .filter(([url]) => !existingByUrl.has(url))
    .map(([url, name]) => ({ url, name }));

  await insertTargets(newProducts.map((p) => ({ site: "amazon" as const, url: p.url, name: p.name })));

  console.log(`Catalog sync (Amazon): ${listingByUrl.size} listed (by expansion), ${newProducts.length} new`);

  await notifyNewProducts(newProducts);
}
