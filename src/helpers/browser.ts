import type { Browser } from "playwright";
import { chromium } from "playwright";

export async function launchBrowser(): Promise<Browser> {
  return chromium.launch({ headless: true });
}
