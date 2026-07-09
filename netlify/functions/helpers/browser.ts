import type { Browser } from "playwright-core";

const isDeployed = Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME);

export async function launchBrowser(): Promise<Browser> {
  if (isDeployed) {
    const chromium = (await import("@sparticuz/chromium")).default;
    const { chromium: playwright } = await import("playwright-core");
    return playwright.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
    });
  }

  // Local dev: use the full `playwright` package, which ships its own browser binary.
  const { chromium: playwright } = await import("playwright");
  return playwright.launch({ headless: true });
}
