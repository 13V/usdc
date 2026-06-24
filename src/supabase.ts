/**
 * supabase.ts — shared Supabase client (server-side, service_role).
 *
 * Used when DATA_BACKEND=supabase. The service_role key bypasses RLS, so this
 * client must NEVER be shipped to the browser — it lives only in the Node API.
 *
 * Env (see .env.example):
 *   SUPABASE_URL                 https://<ref>.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY    service_role JWT
 */

import "dotenv/config";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

export const DATA_BACKEND = (process.env.DATA_BACKEND || "sqlite").toLowerCase();
export const usingSupabase = DATA_BACKEND === "supabase";

let _client: SupabaseClient | null = null;

/** Lazily construct the singleton client; throws if env is missing. */
export function supabase(): SupabaseClient {
  if (_client) return _client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Supabase backend selected but SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set. " +
        "Add them to .env (see .env.example)."
    );
  }
  _client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _client;
}
