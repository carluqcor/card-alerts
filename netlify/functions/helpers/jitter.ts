export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function randomJitter(maxMinutes: number): Promise<void> {
  const maxMs = Math.max(0, maxMinutes) * 60_000;
  const delayMs = Math.floor(Math.random() * maxMs);
  await sleep(delayMs);
}
