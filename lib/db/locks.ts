/**
 * Distributed lock via trading_strategy_states row (DB).
 * Prefer Postgres advisory lock when raw SQL available; here we use optimistic unique claim.
 */

import { requireTraderDb } from "./client";

export async function tryAcquireWorkerLock(workerId: string, ttlMs = 60_000): Promise<boolean> {
  const db = requireTraderDb();
  const now = Date.now();
  const expires = new Date(now + ttlMs).toISOString();
  const { data: existing } = await db
    .from("trading_strategy_states")
    .select("key,value,updated_at")
    .eq("key", "worker_lock")
    .maybeSingle();

  const value = (existing?.value ?? {}) as { workerId?: string; expiresAt?: string };
  if (value.expiresAt && Date.parse(value.expiresAt) > now && value.workerId !== workerId) {
    return false;
  }

  const payload = { workerId, expiresAt: expires };
  if (!existing) {
    const { error } = await db.from("trading_strategy_states").insert({
      key: "worker_lock",
      value: payload,
      updated_at: new Date().toISOString(),
    });
    return !error;
  }
  const { error } = await db
    .from("trading_strategy_states")
    .update({ value: payload, updated_at: new Date().toISOString() })
    .eq("key", "worker_lock");
  return !error;
}

export async function releaseWorkerLock(workerId: string): Promise<void> {
  const db = requireTraderDb();
  const { data } = await db.from("trading_strategy_states").select("value").eq("key", "worker_lock").maybeSingle();
  const value = (data?.value ?? {}) as { workerId?: string };
  if (value.workerId !== workerId) return;
  await db.from("trading_strategy_states").update({
    value: { workerId: null, expiresAt: null },
    updated_at: new Date().toISOString(),
  }).eq("key", "worker_lock");
}

export function buildIdempotencyKey(parts: {
  tradingDay: string;
  ticker: string;
  strategyVersion: string;
  signalKind: string;
  side: "buy" | "sell";
}): string {
  return [parts.tradingDay, parts.ticker, parts.strategyVersion, parts.signalKind, parts.side].join(":");
}
