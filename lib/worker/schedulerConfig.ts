/** 실행 시각(Asia/Seoul 분) — 설정으로 분리 */
export const WORKER_SCHEDULE = {
  preMarketSyncMinutes: 7 * 60 + 50, // 07:50
  intradayWatchEveryMs: 30_000,
  closePrepMinutes: 15 * 60 + 25, // 15:25
  signalAfterCloseMinutes: 15 * 60 + 35, // 15:35 KRX 종가 확정 후
  afterMarketWatchEveryMs: 20_000,
  eodReconcileMinutes: 20 * 60 + 5, // 20:05
  heartbeatEveryMs: 20_000,
  cycleLockTtlMs: 55_000,
} as const;
