import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
// Supabase's newer API key format calls this the "secret key" (sb_secret_...) instead of
// "service role key" (a JWT). Support either env var name.
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;

if (!url || !serviceRoleKey) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY/SUPABASE_SECRET_KEY");
}

export const supabase = createClient(url, serviceRoleKey);

export interface Target {
  id: string;
  site: "amazon" | "carrefour" | "boosterbox";
  url: string;
  name: string;
  active: boolean;
  price_selector: string | null;
  stock_selector: string | null;
  image_url: string | null;
}

export async function getActiveTargets(site?: Target["site"]): Promise<Target[]> {
  // Ordered so batching (splitting targets across scheduled runs) is stable across invocations.
  let query = supabase.from("targets").select("*").eq("active", true).order("created_at", { ascending: true });
  if (site) query = query.eq("site", site);

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function getLastCheck(targetId: string) {
  const { data, error } = await supabase
    .from("checks")
    .select("*")
    .eq("target_id", targetId)
    .order("checked_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function getMinPrice(targetId: string): Promise<number | null> {
  const { data, error } = await supabase
    .from("checks")
    .select("price")
    .eq("target_id", targetId)
    .not("price", "is", null)
    .order("price", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data?.price ?? null;
}

export async function insertCheck(check: {
  target_id: string;
  price: number | null;
  currency: string | null;
  in_stock: boolean | null;
  original_price?: number | null;
  promo_label?: string | null;
  campaign_label?: string | null;
  raw?: unknown;
}) {
  const { error } = await supabase.from("checks").insert(check);
  if (error) throw error;
}

export async function updateTargetImage(targetId: string, imageUrl: string): Promise<void> {
  const { error } = await supabase.from("targets").update({ image_url: imageUrl }).eq("id", targetId);
  if (error) throw error;
}

export async function getExistingTargetUrls(): Promise<Set<string>> {
  const { data, error } = await supabase.from("targets").select("url");
  if (error) throw error;
  return new Set((data ?? []).map((row) => row.url as string));
}

export async function insertTargets(
  rows: { site: Target["site"]; url: string; name: string }[]
): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await supabase.from("targets").insert(rows);
  if (error) throw error;
}

export async function getAllTargetsForSite(
  site: Target["site"]
): Promise<Pick<Target, "id" | "url" | "active" | "name">[]> {
  const { data, error } = await supabase.from("targets").select("id, url, active, name").eq("site", site);
  if (error) throw error;
  return data ?? [];
}

export async function setTargetActive(id: string, active: boolean): Promise<void> {
  const { error } = await supabase.from("targets").update({ active }).eq("id", id);
  if (error) throw error;
}
