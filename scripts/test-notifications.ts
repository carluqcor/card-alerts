import { notifyTelegram } from "../src/helpers/notify.js";
import {
  detectNotifyEvents,
  formatNotifyLines,
  type PreviousCheck,
} from "../src/scrape.js";
import type { ScrapeResult } from "../src/scrapers/types.js";

interface Scenario {
  label: string;
  previous: PreviousCheck | null;
  result: ScrapeResult;
  historicalMinPrice: number | null;
}

const scenarios: Scenario[] = [
  {
    label: "Restocked",
    previous: { price: 20, in_stock: false, original_price: null, promo_label: null, campaign_label: null },
    result: { price: 20, currency: "EUR", inStock: true },
    historicalMinPrice: 18,
  },
  {
    label: "Went out of stock",
    previous: { price: 20, in_stock: true, original_price: null, promo_label: null, campaign_label: null },
    result: { price: 20, currency: "EUR", inStock: false },
    historicalMinPrice: 18,
  },
  {
    label: "New offer",
    previous: { price: 20, in_stock: true, original_price: null, promo_label: null, campaign_label: null },
    result: { price: 15, currency: "EUR", inStock: true, promoLabel: "3x2", originalPrice: 20 },
    historicalMinPrice: 15,
  },
  {
    label: "Price dropped",
    previous: { price: 15, in_stock: true, original_price: null, promo_label: null, campaign_label: null },
    result: { price: 13, currency: "EUR", inStock: true },
    historicalMinPrice: 13,
  },
  {
    label: "Price increased",
    previous: { price: 13, in_stock: true, original_price: null, promo_label: null, campaign_label: null },
    result: { price: 16, currency: "EUR", inStock: true },
    historicalMinPrice: 13,
  },
  {
    label: "All-time low",
    previous: { price: 16, in_stock: true, original_price: null, promo_label: null, campaign_label: null },
    result: { price: 12, currency: "EUR", inStock: true },
    historicalMinPrice: 13,
  },
  {
    label: "Combined (restocked + new offer + all-time low)",
    previous: { price: 25, in_stock: false, original_price: null, promo_label: null, campaign_label: null },
    result: { price: 10, currency: "EUR", inStock: true, promoLabel: "2ª unidad -70%" },
    historicalMinPrice: 18,
  },
];

for (const scenario of scenarios) {
  const events = detectNotifyEvents(scenario.previous, scenario.result, scenario.historicalMinPrice);
  const eventLines = formatNotifyLines(events, scenario.previous, scenario.result);

  if (eventLines.length === 0) {
    console.log(`[${scenario.label}] NO EVENTS DETECTED — expected at least one`);
    continue;
  }

  const message = [`<b>TEST: ${scenario.label}</b>`, "https://example.com/test", ...eventLines].join("\n");
  await notifyTelegram(message);
  console.log(`[${scenario.label}] sent:`, eventLines);

  await new Promise((resolve) => setTimeout(resolve, 700));
}

console.log("\nDone — check Telegram for 7 test messages.");
