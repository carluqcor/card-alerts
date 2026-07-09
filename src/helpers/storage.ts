import { supabase } from "./db.js";

const BUCKET = "product-images";
let bucketEnsured = false;

async function ensureBucket(): Promise<void> {
  if (bucketEnsured) return;
  const { error } = await supabase.storage.createBucket(BUCKET, { public: true });
  // Ignore "already exists" — any other error should surface.
  if (error && !error.message.toLowerCase().includes("already exists")) throw error;
  bucketEnsured = true;
}

export function isOwnedStorageUrl(url: string | null | undefined): boolean {
  return Boolean(url && url.includes(`/storage/v1/object/public/${BUCKET}/`));
}

export async function uploadProductImage(
  key: string,
  bytes: Buffer,
  contentType: string
): Promise<string> {
  await ensureBucket();

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(key, bytes, { contentType, upsert: true });
  if (error) throw error;

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(key);
  return data.publicUrl;
}
