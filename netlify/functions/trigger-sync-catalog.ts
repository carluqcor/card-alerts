import type { Handler } from "@netlify/functions";

// Crawling category pages + diffing takes longer than the 30s scheduled-function cap allows,
// so this thin function just kicks off sync-catalog-background.ts and returns immediately.
export const handler: Handler = async () => {
  const baseUrl = process.env.URL;
  if (!baseUrl) throw new Error("Missing URL env var (site's own base address)");

  await fetch(`${baseUrl}/.netlify/functions/sync-catalog-background`, { method: "POST" });

  return { statusCode: 202, body: "triggered" };
};
