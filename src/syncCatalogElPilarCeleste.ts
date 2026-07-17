import { crawlElPilarCelesteListing } from "./helpers/elPilarCelesteCategoryCrawler.js";
import { getAllTargetsForSite, insertTargets } from "./helpers/db.js";
import { notifyTelegram } from "./helpers/notify.js";

// Scoped to Spanish-language Pokémon TCG products only (per how this URL was chosen).
const LISTING_URL = "https://elpilarceleste.es/categoria-producto/material-tcg/pokemon-tcg/?filter_idioma=espanol&per_page=24";

async function notifyNewProducts(products: { url: string; name: string }[]): Promise<void> {
  if (products.length === 0) return;

  const shown = products.slice(0, 10);
  const lines = [
    `🆕 <b>[ElPilarCeleste] ${products.length} new product${products.length > 1 ? "s" : ""} found</b>`,
    ...shown.map((p) => `• ${p.name}\n${p.url}`),
  ];
  if (products.length > shown.length) {
    lines.push(`…and ${products.length - shown.length} more`);
  }

  await notifyTelegram(lines.join("\n"));
}

// This only ever adds newly-seen products; it never deactivates anything based on listing
// absence (this listing has no stock filter at all — it's just the full Spanish-language
// Pokémon TCG category — so real stock is entirely determined by the scraper's own Store API
// check, see src/scrapers/elpilarceleste.ts).
export async function runSyncCatalogElPilarCeleste(): Promise<void> {
  const listed = await crawlElPilarCelesteListing(LISTING_URL);
  const listingByUrl = new Map(listed.map((p) => [p.url, p.name]));

  const existing = await getAllTargetsForSite("elpilarceleste");
  const existingByUrl = new Map(existing.map((t) => [t.url, t]));

  const newProducts = [...listingByUrl.entries()]
    .filter(([url]) => !existingByUrl.has(url))
    .map(([url, name]) => ({ url, name }));

  await insertTargets(newProducts.map((p) => ({ site: "elpilarceleste" as const, url: p.url, name: p.name })));

  console.log(`Catalog sync (ElPilarCeleste): ${listingByUrl.size} listed, ${newProducts.length} new`);

  await notifyNewProducts(newProducts);
}
