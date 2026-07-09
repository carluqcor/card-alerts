import { crawlCarrefourCategory } from "./helpers/carrefourCategoryCrawler.js";
import { getAllTargetsForSite, insertTargets, setTargetActive } from "./helpers/db.js";
import { notifyTelegram } from "./helpers/notify.js";

// The category listings we track for auto-discovery. Add more URLs here if you start
// tracking additional Carrefour categories.
const CATEGORY_URLS = [
  "https://www.carrefour.es/juguetes/juegos-tradicionales/juegos-de-mesa-juegos-de-sociedad-pokemon-vendido-por-carrefour/F-1033Z10hlZ1a42Z13rjp/c",
];

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

// The category crawl has proven unreliable enough (observed collecting anywhere from ~30% to
// ~75% of the real catalog across different runs, due to lazy-load pagination under-reporting —
// not real listing changes) that no plausibility ratio can safely distinguish "a flaky crawl"
// from "products genuinely delisted." A 0.7 threshold once let a 74%-complete crawl slip through
// and wrongly deactivated 17 real products. So deactivation is never automatic — a product
// missing from the crawl only gets flagged here for manual review, never auto-removed.
async function notifyPossiblyDelisted(products: { url: string; name: string }[]): Promise<void> {
  if (products.length === 0) return;

  const shown = products.slice(0, 10);
  const lines = [
    `❓ <b>${products.length} product${products.length > 1 ? "s" : ""} missing from the last crawl</b> ` +
      `— could be genuinely delisted, or just an incomplete crawl (this happens often). ` +
      `Verify manually before deactivating:`,
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

  const newProducts = [...listingByUrl.entries()]
    .filter(([url]) => !existingByUrl.has(url))
    .map(([url, name]) => ({ url, name }));

  const toReactivate = existing.filter((t) => !t.active && listingByUrl.has(t.url));
  const possiblyDelisted = existing
    .filter((t) => t.active && !listingByUrl.has(t.url))
    .map((t) => ({ url: t.url, name: t.name }));

  await insertTargets(newProducts.map((p) => ({ site: "carrefour" as const, url: p.url, name: p.name })));
  for (const t of toReactivate) await setTargetActive(t.id, true);

  console.log(
    `Catalog sync: ${listingByUrl.size} listed, ${newProducts.length} new, ` +
      `${toReactivate.length} relisted, ${possiblyDelisted.length} missing from crawl (not auto-deactivated)`
  );

  await notifyNewProducts(newProducts);
  await notifyPossiblyDelisted(possiblyDelisted);
}
