import type { Handler } from "@netlify/functions";

// Scheduled functions (trigger-scrape.ts) reject direct HTTP calls that aren't from Netlify's
// own scheduler, so the dashboard's manual "scan now" button needs this separate, freely
// callable endpoint instead. It kicks off the same self-chaining mini-batch sequence.
export const handler: Handler = async () => {
  const baseUrl = process.env.URL;
  if (!baseUrl) throw new Error("Missing URL env var (site's own base address)");

  await fetch(`${baseUrl}/.netlify/functions/scrape-background`, { method: "POST" });

  return { statusCode: 202, body: "triggered" };
};
