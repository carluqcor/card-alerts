import { crawlCarrefourCategory } from "../src/helpers/carrefourCategoryCrawler.js";
import { getExistingTargetUrls, insertTargets } from "../src/helpers/db.js";

async function main() {
  const categoryUrl = process.argv[2];
  if (!categoryUrl) {
    throw new Error("Usage: tsx scripts/discover-carrefour-category.ts <category-url>");
  }

  const products = await crawlCarrefourCategory(categoryUrl);
  console.log(`Found ${products.length} unique Carrefour-sold products.`);

  const existing = await getExistingTargetUrls();
  const toInsert = products
    .filter((p) => !existing.has(p.url))
    .map((p) => ({ site: "carrefour" as const, url: p.url, name: p.name }));

  await insertTargets(toInsert);

  console.log(
    `Inserted ${toInsert.length} new targets, ${products.length - toInsert.length} already existed.`
  );
}

try {
  await main();
} catch (err) {
  console.error(err);
  process.exit(1);
}
