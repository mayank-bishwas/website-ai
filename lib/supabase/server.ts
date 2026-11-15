import "server-only";

import { createClient } from "@supabase/supabase-js";

export function createSupabaseServerClient() {
  const supabaseUrl = process.env.SHAHI_MEVA_SUPABASE_URL;
  const secretKey = process.env.SHAHI_MEVA_SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !secretKey) {
    throw new Error("Missing SHAHI_MEVA_SUPABASE_URL or SHAHI_MEVA_SUPABASE_SECRET_KEY.");
  }

  return createClient(supabaseUrl, secretKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}
