import type { Page } from "playwright";
import { scrapeAmazon } from "./amazon.js";
import { scrapeCarrefour } from "./carrefour.js";
import { scrapeBoosterBox } from "./theboosterbox.js";
import type { ScrapeResult, TargetConfig } from "./types.js";

const registry: Record<TargetConfig["site"], (page: Page, target: TargetConfig) => Promise<ScrapeResult>> = {
  amazon: scrapeAmazon,
  carrefour: scrapeCarrefour,
  boosterbox: scrapeBoosterBox,
};

export function scrapeBySite(site: TargetConfig["site"]) {
  const scraper = registry[site];
  if (!scraper) throw new Error(`No scraper registered for site "${site}"`);
  return scraper;
}

export * from "./types.js";
