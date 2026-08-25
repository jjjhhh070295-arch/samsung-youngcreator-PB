/**
 * Independent auto-trading worker (NOT inside Next.js request handlers).
 * Start: npm run worker
 */

import { getKisConfig, isLiveTradingEnabled } from "../lib/kis/config";
import { isTraderDbConfigured, getTraderDb } from "../lib/db/client";
import { tryAcquireWorkerLock, releaseWorkerLock } from "../lib/db/locks";
import { resolveTradingCalendar, heuristicTradingDay, seoulDateKey } from "../lib/market/calendar";
import { detectMarketSessions, minutesOfSeoulDay } from "../lib/market/sessions";
import { writeHeartbeat } from "../lib/worker/heartbeat";
import { WORKER_SCHEDULE } from "../lib/worker/schedulerConfig";
import { runWorkerCycle } from "../lib/worker/cycle";

const workerId = process.env.WORKER_ID?.trim() || `worker-${process.pid}`;
let shuttingDown = false;
const startedAt = new Date().toISOString();

function log(msg: string, meta?: unknown) {
  const line = meta ? `${msg} ${JSON.stringify(meta)}` : msg;
  console.log(`[worker ${workerId}] ${line}`);
}

async function boot() {
  log("booting");
  const cfg = getKisConfig();
  if (!cfg.appKey || !cfg.appSecret) {
    log("WARN: KIS keys missing — dry-run / blocked live");
  }
  if (!isTraderDbConfigured()) {
    log("WARN: Trader DB not configured — persistence disabled, orders blocked for live");
  } else {
    const db = getTraderDb();
    const { error } = await db!.from("trading_admin_settings").select("id").limit(1);
    if (error) log("DB ping failed", { message: error.message });
    else log("DB ok");
  }

  log("live flag", { kisLive: isLiveTradingEnabled() });

  const calendar = await resolveTradingCalendar({
    allowHeuristicFallback: process.env.TRADING_DEMO_MODE === "true",
    provider: process.env.TRADING_DEMO_MODE === "true"
      ? undefined
      : async () => {
          // Placeholder: plug KIS business-day API here. Fail-closed if unset in prod.
          const day = heuristicTradingDay();
          return { source: "bootstrap-heuristic-pending-kis", days: [day] };
        },
  });
  log("calendar", { ok: calendar.ok, today: calendar.today, trading: calendar.isTradingDay, source: calendar.source });

  await writeHeartbeat(workerId, "online", { startedAt, phase: "boot" });
  log("scheduler start");
}

async function tick() {
  if (shuttingDown) return;
  const locked = await (async () => {
    try {
      return await tryAcquireWorkerLock(workerId, WORKER_SCHEDULE.cycleLockTtlMs);
    } catch {
      return true; // DB 없으면 단일 프로세스 가정
    }
  })();
  if (!locked) {
    log("lock held by another worker — skip");
    return;
  }
  try {
    await writeHeartbeat(workerId, "online", { startedAt, phase: "tick" });
    const cal = await resolveTradingCalendar({
      allowHeuristicFallback: process.env.TRADING_DEMO_MODE === "true",
    });
    const session = detectMarketSessions(new Date(), { isTradingDay: cal.ok && cal.isTradingDay });
    const result = await runWorkerCycle({
      workerId,
      calendar: cal,
      session,
      minutes: minutesOfSeoulDay(),
    });
    if (result.summary) log(result.summary);
  } catch (e) {
    log("tick error", { error: e instanceof Error ? e.message : String(e) });
  } finally {
    try { await releaseWorkerLock(workerId); } catch { /* ignore */ }
  }
}

async function main() {
  await boot();
  const interval = Number(process.env.STRATEGY_INTERVAL_MS ?? WORKER_SCHEDULE.intradayWatchEveryMs);
  await tick();
  const handle = setInterval(() => { void tick(); }, Math.max(5_000, interval));

  const shutdown = async (sig: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`graceful shutdown (${sig})`);
    clearInterval(handle);
    try { await writeHeartbeat(workerId, "offline", { startedAt, phase: "shutdown" }); } catch { /* */ }
    try { await releaseWorkerLock(workerId); } catch { /* */ }
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

void main();
