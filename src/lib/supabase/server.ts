import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabasePublishableKey, supabaseSecretKey, supabaseUrl } from "@/lib/env";

const noPersist = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
} as const;

let readClient: SupabaseClient | null = null;
let adminClient: SupabaseClient | null = null;

/**
 * Publishable key, subject to RLS. This app's tables have RLS on with no
 * policies, so this client deliberately sees nothing -- it exists so that a
 * future public-read table can be served without touching the secret key.
 */
export function supabaseRead(): SupabaseClient {
  readClient ??= createClient(supabaseUrl(), supabasePublishableKey(), noPersist);
  return readClient;
}

/**
 * Secret key, bypasses RLS. Server-only, and never reachable from a route
 * that isn't behind requireAdmin() or a server-rendered page.
 */
export function supabaseAdmin(): SupabaseClient {
  adminClient ??= createClient(supabaseUrl(), supabaseSecretKey(), noPersist);
  return adminClient;
}
