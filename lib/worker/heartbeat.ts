import { getTraderDb } from "@/lib/db/client";

const HEARTBEAT_STALE_MS = 90_000;

export async function writeHeartbeat(workerId: string, status = "online", meta: Record<string, unknown> = {}): Promise<void> {
  const db = getTraderDb();
  if (!db) return;
  const now = new Date().toISOString();
  await db.from("trading_worker_heartbeats").upsert({
    worker_id: workerId,
    started_at: meta.startedAt ?? now,
    last_heartbeat_at: now,
    status,
    meta,
  });
}

export async function isHeartbeatFresh(maxAgeMs = HEARTBEAT_STALE_MS): Promise<{ ok: boolean; last?: string; workerId?: string }> {
  const db = getTraderDb();
  if (!db) return { ok: false };
  const { data } = await db.from("trading_worker_heartbeats").select("*").order("last_heartbeat_at", { ascending: false }).limit(1);
  const row = data?.[0] as { worker_id?: string; last_heartbeat_at?: string } | undefined;
  if (!row?.last_heartbeat_at) return { ok: false };
  const age = Date.now() - Date.parse(row.last_heartbeat_at);
  return { ok: age <= maxAgeMs, last: row.last_heartbeat_at, workerId: row.worker_id };
}
