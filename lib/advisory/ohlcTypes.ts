/** 일봉 OHLCV + 출처 메타. 결정론 지표·봉차트의 공통 입력. */
export interface OhlcBar {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface OhlcDaily {
  symbol: string;
  name: string;
  exchange: string;
  currency: string;
  asOf: string;
  bars: OhlcBar[];
  lastPrice: number;
  previousClose: number | null;
  historySource: string;
  priceSource: string;
  quoteDelayMinutes: number | null;
  marketState: string | null;
}

export interface InvestorFlowBar {
  time: string;
  foreignNet: number;
  institutionNet: number;
  individualNet: number;
}

export interface InvestorFlowSeries {
  asOf: string;
  source: string;
  connected: boolean;
  bars: InvestorFlowBar[];
  note?: string;
}

export interface FinancialSnapshot {
  netIncome: number | null;
  revenueGrowthPct: number | null;
  asOf: string;
  source: string;
  currency: string | null;
}
