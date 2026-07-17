import { crawlFlashStoreListing } from "./helpers/flashStoreCategoryCrawler.js";
import { getAllTargetsForSite, insertTargets } from "./helpers/db.js";
import { notifyTelegram } from "./helpers/notify.js";

async function notifyNewProducts(products: { url: string; name: string }[]): Promise<void> {
  if (products.length === 0) return;

  const shown = products.slice(0, 10);
  const lines = [
    `🆕 <b>[FlashStore] ${products.length} new product${products.length > 1 ? "s" : ""} found</b>`,
    ...shown.map((p) => `• ${p.name}\n${p.url}`),
  ];
  if (products.length > shown.length) {
    lines.push(`…and ${products.length - shown.length} more`);
  }

  await notifyTelegram(lines.join("\n"));
}

// This has no stock filter at all (the Store API's own filter params are non-functional here —
// see src/helpers/flashStoreCategoryCrawler.ts) — real stock is entirely determined by the
// scraper's own Store API check on each pass. So this only ever adds newly-seen products; it
// never deactivates anything based on listing absence.
export async function runSyncCatalogFlashStore(): Promise<void> {
  const listed = await crawlFlashStoreListing();
  const listingByUrl = new Map(listed.map((p) => [p.url, p.name]));

  const existing = await getAllTargetsForSite("flashstore");
  const existingByUrl = new Map(existing.map((t) => [t.url, t]));

  const newProducts = [...listingByUrl.entries()]
    .filter(([url]) => !existingByUrl.has(url))
    .map(([url, name]) => ({ url, name }));

  await insertTargets(newProducts.map((p) => ({ site: "flashstore" as const, url: p.url, name: p.name })));

  console.log(`Catalog sync (FlashStore): ${listingByUrl.size} listed (Spanish), ${newProducts.length} new`);

  await notifyNewProducts(newProducts);
}
