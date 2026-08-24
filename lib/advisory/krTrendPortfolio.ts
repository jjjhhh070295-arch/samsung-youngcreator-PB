/** 트레이더 앱용 확정 종목 타입 (PB 포트폴리오 의존 제거) */

export interface PbSelectedKoreanStock {
  ticker: string;
  name: string;
  weightPct?: number;
  marketCapWon?: number | null;
  changePct?: number;
  seedWon?: number;
  entryPrice?: number;
  stopLossPrice?: number;
  takeProfitPrice?: number;
  rewardRiskRatio?: number | null;
}
