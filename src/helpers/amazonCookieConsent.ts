import type { Page } from "playwright";

const ACCEPT_BUTTON_SELECTOR = "#sp-cc-accept";

// A real visitor dismisses this before browsing further, rather than leaving a blocking banner
// up while scripts run underneath it — accepting (not rejecting) matters specifically because
// this project's whole goal is seeing the same full, personalized experience a real consenting
// visitor gets (e.g. the store page's personalization-driven expansion submenu); rejecting risks
// an even more stripped-down page, the opposite of what a discovery crawler needs.
export async function acceptAmazonCookies(page: Page): Promise<void> {
  const button = page.locator(ACCEPT_BUTTON_SELECTOR);
  if ((await button.count()) > 0) {
    await button.click({ timeout: 3000 }).catch(() => {});
  }
}
