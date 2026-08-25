/**
 * Trader-only DB client. Uses TRADER_DATABASE_URL or SUPABASE service role.
 * Never shares PB Insight table writes.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null | undefined;

export function isTraderDbConfigured(): boolean {
  const url = process.env.TRADER_SUPABASE_URL?.trim() || process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key =
    process.env.TRADER_SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  return Boolean(url && key);
}

export function getTraderDb(): SupabaseClient | null {
  if (client !== undefined) return client;
  if (!isTraderDbConfigured()) {
    client = null;
    return null;
  }
  const url = process.env.TRADER_SUPABASE_URL?.trim() || process.env.NEXT_PUBLIC_SUPABASE_URL!.trim();
  const key =
    process.env.TRADER_SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY!.trim();
  client = createClient(url, key, { auth: { persistSession: false } });
  return client;
}

export function resetTraderDbForTests(): void {
  client = undefined;
}

export class DbUnavailableError extends Error {
  constructor(message = "Trader DB unavailable — orders blocked") {
    super(message);
    this.name = "DbUnavailableError";
  }
}

export function requireTraderDb(): SupabaseClient {
  const db = getTraderDb();
  if (!db) throw new DbUnavailableError();
  return db;
}
