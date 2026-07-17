import type { Page } from "playwright";
import { scrapeAmazon } from "./amazon.js";
import { scrapeCarrefour } from "./carrefour.js";
import { scrapeBoosterBox } from "./theboosterbox.js";
import { scrapeTodoHits } from "./todohits.js";
import { scrapeWiniGames } from "./winigames.js";
import { scrapePokemillon } from "./pokemillon.js";
import { scrapeKameHouseCards } from "./kamehousecards.js";
import { scrapeEpicHitStore } from "./epichitstore.js";
import type { ScrapeResult, TargetConfig } from "./types.js";

const registry: Record<TargetConfig["site"], (page: Page, target: TargetConfig) => Promise<ScrapeResult>> = {
  amazon: scrapeAmazon,
  carrefour: scrapeCarrefour,
  boosterbox: scrapeBoosterBox,
  todohits: scrapeTodoHits,
  winigames: scrapeWiniGames,
  pokemillon: scrapePokemillon,
  kamehousecards: scrapeKameHouseCards,
  epichitstore: scrapeEpicHitStore,
};

export function scrapeBySite(site: TargetConfig["site"]) {
  const scraper = registry[site];
  if (!scraper) throw new Error(`No scraper registered for site "${site}"`);
  return scraper;
}

export * from "./types.js";
