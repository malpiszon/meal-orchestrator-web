import { createClient } from "@supabase/supabase-js";

const KEEPALIVE_REQUEST_COUNT = 3;

export async function pingSupabase(url: string, key: string): Promise<void> {
  if (!url || !key) {
    throw new Error("pingSupabase: missing Supabase url or key");
  }

  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  for (let i = 0; i < KEEPALIVE_REQUEST_COUNT; i++) {
    const { error } = await client.rpc("keepalive");

    if (error) {
      throw new Error(`pingSupabase: ${error.message}`);
    }
  }
}
