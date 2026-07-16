import { crawlAmazonStoreByExpansion } from "../src/helpers/amazonStoreCrawler.js";
import { getExistingTargetUrls, insertTargets } from "../src/helpers/db.js";

const existing = await getExistingTargetUrls();
const discovered = await crawlAmazonStoreByExpansion();

const newTargets = discovered
  .filter((p) => !existing.has(p.url))
  .map((p) => ({ site: "amazon" as const, url: p.url, name: p.name }));

await insertTargets(newTargets);
console.log(`Discovered ${discovered.length} products across all expansions, ${newTargets.length} new.`);
for (const t of newTargets) console.log(`  + ${t.name}`);
