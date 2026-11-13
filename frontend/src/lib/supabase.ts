"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Decision } from "./heliquant";

/**
 * Browser Supabase client — uses the PUBLISHABLE (anon) key, which is public-safe:
 * RLS on `decisions_hq` allows SELECT only, and the agent writes with the service_role key
 * server-side (never shipped to the browser). There is NO fallback project: NEXT_PUBLIC_SUPABASE_URL and
 * NEXT_PUBLIC_SUPABASE_ANON_KEY must be set (see .env.example). When they are empty the client is null and the
 * feed shows as unavailable instead of silently reading another project.
 */
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export const supabase: SupabaseClient | null =
  SUPABASE_URL && SUPABASE_ANON_KEY ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

export const DECISIONS_TABLE = "decisions_hq";

/** Live decisions feed (RLS public-read). Client-side; returns [] gracefully if unavailable. */
export async function fetchDecisions(limit = 30): Promise<Decision[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from(DECISIONS_TABLE)
    .select("*")
    .order("id", { ascending: false })
    .limit(limit);
  if (error) {
    console.warn("[heliquant] fetchDecisions:", error.message);
    return [];
  }
  return (data ?? []) as Decision[];
}
