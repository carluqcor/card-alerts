import { runScrape } from "../src/scrape.js";

// Each site gets its own workflow/schedule (see .github/workflows/) so different retailers'
// scrapes and notifications never interleave — set per-workflow, not shared.
const site = process.env.SCRAPE_SITE as "amazon" | "carrefour" | undefined;

await runScrape(site);
