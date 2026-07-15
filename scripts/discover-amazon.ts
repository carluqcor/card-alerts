import { launchBrowser } from "../src/helpers/browser.js";
import { getExistingTargetUrls, insertTargets } from "../src/helpers/db.js";

// One-time seed from a curated Amazon storefront link (not a recurring catalog sync — unlike
// the other sites, there's no live "category" page here to keep re-crawling; this is a static
// curated ASIN list). To track a different/expanded set later, update this list and re-run.
const ASINS = [
  "B0GZKZ1FL9", "B0GZL2WPMF", "B0GZL8WKB6", "B0GZL7PBX1", "B0H1HJGYVV", "B0H29TRBMW",
  "B0H1HDKXGH", "B0H3LQY1Q7", "B0GYSJDWDS", "B0GYSKSSTH", "B0GYSDGPBH", "B0GYSKFHBY",
  "B0GYSGQ9R8", "B0GSSR9ZNS", "B0GSSJ9RB1", "B0GSSQYPK3", "B0FXTY9D99", "B0G4NVYMTH",
  "B0G7HYD9WC", "B0G7JDFL9J", "B0G7HV2DXB", "B0GMR6QZV6", "B0FX19JX78", "B0FX1C91HR",
  "B0G7HV1J57", "B0G4NT3SH1", "B0G4NS7XT2", "B0G4NSB2J1", "B0G7JFFSF4", "B0G7JRZNBY",
  "B0G4NT35J8", "B0G4NQK15P", "B0G4NS1BCR", "B0G4NS6SJY", "B0G4NQ9LVW", "B0G3XHTC4T",
  "B0GGHTN8TG", "B0FTFZXNBX", "B0FTG3C43P", "B0FTG4FS2G", "B0FTG2HV37", "B0FTG4DGK7",
  "B0FY3165VP", "B0FPCTN3Q9", "B0FPMXHZLT", "B0FTCXPDCH", "B0FR4Y2KP4", "B0FP2X5YWJ",
  "B0FP3146KJ", "B0FP2XV359", "B0FP2YDZR5", "B0GGJ74MWD", "B0GGHZTKP4", "B0GGHXWSDC",
  "B0GGJ2YJQ5", "B0GMR6ZK3R", "B0GMRC58KQ",
];

async function main() {
  const existing = await getExistingTargetUrls();
  const browser = await launchBrowser();
  const newTargets: { site: "amazon"; url: string; name: string }[] = [];

  try {
    for (const [index, asin] of ASINS.entries()) {
      const url = `https://www.amazon.es/dp/${asin}`;
      if (existing.has(url)) {
        console.log(`[${index + 1}/${ASINS.length}] already tracked, skipping: ${asin}`);
        continue;
      }

      if (index > 0) {
        await new Promise((resolve) => setTimeout(resolve, 3000 + Math.floor(Math.random() * 3000)));
      }

      const context = await browser.newContext({
        locale: "es-ES",
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      });
      try {
        const page = await context.newPage();
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
        await page.waitForTimeout(1500);
        const rawTitle = await page.title();
        const name = rawTitle.split(/\s*:\s*Amazon\.es/i)[0].trim() || asin;
        console.log(`[${index + 1}/${ASINS.length}] ${asin}: ${name}`);
        newTargets.push({ site: "amazon", url, name });
      } catch (err) {
        console.error(`[${index + 1}/${ASINS.length}] FAILED: ${asin}`, err);
      } finally {
        await context.close();
      }
    }

    await insertTargets(newTargets);
    console.log(`\nInserted ${newTargets.length} new Amazon targets.`);
  } finally {
    await browser.close();
  }
}

main();
