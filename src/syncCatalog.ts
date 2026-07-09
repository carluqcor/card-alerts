import { crawlCarrefourCategory } from "./helpers/carrefourCategoryCrawler.js";
import { getAllTargetsForSite, insertTargets, setTargetActive } from "./helpers/db.js";
import { notifyTelegram } from "./helpers/notify.js";

// The category listings we track for auto-discovery. Add more URLs here if you start
// tracking additional Carrefour categories.
const CATEGORY_URLS = [
  "https://www.carrefour.es/juguetes/juegos-tradicionales/juegos-de-mesa-juegos-de-sociedad-pokemon-vendido-por-carrefour/F-1033Z10hlZ1a42Z13rjp/c",
];

// A degraded/rate-limited crawl can return far fewer products than actually exist (observed:
// Carrefour's own pagination text claimed 65 while the rendered grid only had 20, consistently
// across 3 fresh-browser retries — likely soft throttling from repeated requests, not a real
// catalog change). Blindly trusting that would deactivate dozens of still-valid products, so
// deactivation is skipped entirely if the listing looks implausibly small vs. what we already
// track — new-product detection still runs, since under-adding is far less harmful than
// wrongly removing real ones.
const MIN_LISTING_RATIO = 0.7;

async function notifyCrawlLooksIncomplete(listed: number, existingActive: number): Promise<void> {
  await notifyTelegram(
    `⚠️ Catalog sync skipped deactivation: crawl found only ${listed} products vs ` +
      `${existingActive} currently tracked as active. Likely a degraded/rate-limited crawl, ` +
      `not a real catalog change.`
  );
}

async function notifyNewProducts(products: { url: string; name: string }[]): Promise<void> {
  if (products.length === 0) return;

  const shown = products.slice(0, 10);
  const lines = [
    `🆕 <b>${products.length} new product${products.length > 1 ? "s" : ""} found</b>`,
    ...shown.map((p) => `• ${p.name}\n${p.url}`),
  ];
  if (products.length > shown.length) {
    lines.push(`…and ${products.length - shown.length} more`);
  }

  await notifyTelegram(lines.join("\n"));
}

export async function runSyncCatalog(): Promise<void> {
  const listingByUrl = new Map<string, string>();
  for (const categoryUrl of CATEGORY_URLS) {
    const products = await crawlCarrefourCategory(categoryUrl);
    for (const p of products) listingByUrl.set(p.url, p.name);
  }

  const existing = await getAllTargetsForSite("carrefour");
  const existingByUrl = new Map(existing.map((t) => [t.url, t]));
  const existingActiveCount = existing.filter((t) => t.active).length;

  const newProducts = [...listingByUrl.entries()]
    .filter(([url]) => !existingByUrl.has(url))
    .map(([url, name]) => ({ url, name }));

  const crawlLooksIncomplete =
    existingActiveCount > 0 && listingByUrl.size < existingActiveCount * MIN_LISTING_RATIO;

  const toReactivate = existing.filter((t) => !t.active && listingByUrl.has(t.url));
  const toDeactivate = crawlLooksIncomplete
    ? []
    : existing.filter((t) => t.active && !listingByUrl.has(t.url));

  await insertTargets(newProducts.map((p) => ({ site: "carrefour" as const, url: p.url, name: p.name })));
  for (const t of toDeactivate) await setTargetActive(t.id, false);
  for (const t of toReactivate) await setTargetActive(t.id, true);

  console.log(
    `Catalog sync: ${listingByUrl.size} listed, ${newProducts.length} new, ` +
      `${toDeactivate.length} delisted, ${toReactivate.length} relisted` +
      (crawlLooksIncomplete ? " (deactivation skipped — crawl looked incomplete)" : "")
  );

  if (crawlLooksIncomplete) {
    await notifyCrawlLooksIncomplete(listingByUrl.size, existingActiveCount);
  }
  await notifyNewProducts(newProducts);
}
