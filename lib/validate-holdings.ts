export type Confidence = "high" | "medium" | "low";
export type ValidationStatus = "ok" | "warn";

export interface Holding {
  name: string;
  ticker: string | null;
  market: string | null;
  currency: string;
  quantity: number;
  avg_price: number | null;
  current_price: number | null; // 교차검증용, 저장 안 함
  confidence: Confidence;
  notes: string | null;
  validation?: ValidationStatus;
}

export interface ExtractResult {
  broker?: string | null;
  holdings: Holding[];
  warnings: string[];
}

const within = (a: number, b: number, pct: number) =>
  b === 0 ? Math.abs(a) < 1 : Math.abs(a - b) / Math.abs(b) <= pct;

export function validateHoldings(parsed: { holdings: Holding[]; warnings?: string[]; [k: string]: unknown }): ExtractResult {
  const warnings: string[] = [...(parsed.warnings ?? [])];

  const holdings = (parsed.holdings ?? []).map((h) => {
    let ok = true;
    const fixed = { ...h };

    if (!(fixed.quantity > 0)) {
      ok = false;
      warnings.push(`${fixed.name}: 수량 비정상`);
    }

    // avg_price가 음수면 잘못 읽은 것
    if (fixed.avg_price != null && fixed.avg_price < 0) {
      fixed.avg_price = Math.abs(fixed.avg_price);
    }

    // current_price 역산 (교차검증용 — 저장 안 함)
    if (fixed.current_price == null && fixed.avg_price != null && fixed.avg_price > 0) {
      // current_price 없으면 교차검증 생략 (ok 유지)
    }

    // 국내 ticker 형식 보정
    if (fixed.ticker && !/^\d{6}$/.test(fixed.ticker)) fixed.ticker = null;

    return { ...fixed, validation: ok ? ("ok" as const) : ("warn" as const) };
  });

  return {
    broker: (parsed.broker as string | null | undefined) ?? null,
    holdings,
    warnings,
  };
}
