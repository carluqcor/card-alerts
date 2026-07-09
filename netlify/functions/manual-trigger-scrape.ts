import type { Handler } from "@netlify/functions";

// The actual scraping now runs on GitHub Actions (fresh VM per run — no more shared-container
// memory issues), not on Netlify. This function just proxies the dashboard's "scan now" button
// to GitHub's workflow_dispatch API, since that call needs a token that can't live client-side.
export const handler: Handler = async () => {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO; // "owner/repo"
  if (!token || !repo) {
    throw new Error("Missing GITHUB_TOKEN or GITHUB_REPO env var");
  }

  const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/scrape.yml/dispatches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({ ref: "master" }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub dispatch failed: ${res.status} ${body}`);
  }

  return { statusCode: 202, body: "triggered" };
};
