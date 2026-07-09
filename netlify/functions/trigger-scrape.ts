import type { Handler } from "@netlify/functions";

// Scheduled functions are capped at 30s, far too short for a batch of ~11 targets (each
// takes ~15-20s). So this thin function just kicks off the real work — scrape-background.ts,
// which has a 15-minute budget — and returns immediately.
export const handler: Handler = async () => {
  const baseUrl = process.env.URL;
  if (!baseUrl) throw new Error("Missing URL env var (site's own base address)");

  await fetch(`${baseUrl}/.netlify/functions/scrape-background`, { method: "POST" });

  return { statusCode: 202, body: "triggered" };
};
