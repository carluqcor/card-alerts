export function parsePrice(text: string | null | undefined): {
  amount: number | null;
  currency: string | null;
} {
  if (!text) return { amount: null, currency: null };

  const currency = text.includes("€") ? "EUR" : text.includes("$") ? "USD" : null;

  // Spanish format uses "," as decimal separator and "." as thousands separator, e.g. "1.234,56 €"
  const cleaned = text
    .replace(/[^0-9.,]/g, "")
    .replace(/\.(?=\d{3},)/g, "") // strip thousands separators before a decimal comma
    .replace(",", ".");

  const amount = parseFloat(cleaned);
  return { amount: Number.isFinite(amount) ? amount : null, currency };
}
