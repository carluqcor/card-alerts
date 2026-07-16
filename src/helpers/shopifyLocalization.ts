import type { BrowserContext } from "playwright";

// Shopify Markets geolocates each fresh session by IP to pick a storefront country/currency,
// then remembers the choice via these two cookies. Our scraper uses a brand-new incognito
// context per target (no persisted cookies), so every single check re-triggers that
// geolocation — and GitHub Actions runner IPs apparently don't always resolve to Spain,
// which was confirmed producing USD prices and a *different* (non-Spain) availability status
// for otherwise-in-stock products, firing false "out of stock" alerts. Pre-setting the cookies
// a real visitor gets after picking "España / EUR" pins the storefront deterministically,
// independent of whatever IP the request happens to come from.
export async function pinSpainStorefront(context: BrowserContext, domain: string): Promise<void> {
  await context.addCookies([
    { name: "localization", value: "ES", domain, path: "/" },
    { name: "cart_currency", value: "EUR", domain, path: "/" },
  ]);
}
