import type { CashFlow } from "@/lib/types";

// 세금 판정 키워드 (bare "세" 제외 -> "월세" 오인 방지)
export const CASHFLOW_TAX_KEYWORDS =
  /세금|법인세|소득세|양도|증여|상속|재산세|종부|종합부동산|취득세|tax/i;

// 비세금(임대료·관리비류) — 라벨 폴백 시 세금 매칭에서 제외
export const NON_TAX_EXPENSE_PATTERN = /월세|전세|임대|임차|세입|관리비/;

// 유출 항목의 세금 여부 — category 우선·단독, 없으면 라벨 정규식 폴백.
// category가 있으면 label/note는 보지 않음(월세 등 라벨 오염 차단).
export function isTaxFlow(flow: CashFlow): boolean {
  const category = (flow.category ?? "").trim();
  if (category) return CASHFLOW_TAX_KEYWORDS.test(category);

  const text = `${flow.label} ${flow.taxAccountingNote ?? ""}`;
  if (NON_TAX_EXPENSE_PATTERN.test(text)) return false;
  return CASHFLOW_TAX_KEYWORDS.test(text);
}
