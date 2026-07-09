import { chromium } from "playwright";
const url = "https://www.carrefour.es/supermercado/helado-de-lima-limon-calippo-sin-gluten-5-ud/R-521031795/p";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  locale: "es-ES",
});
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForTimeout(2000);
console.log("FINAL_URL:", page.url());
const buyboxHtml = await page.evaluate(() => {
  const el = document.querySelector(".buybox");
  return el ? el.outerHTML.slice(0, 1500) : "BUYBOX_NOT_FOUND";
});
console.log("BUYBOX_HTML:\n", buyboxHtml);
