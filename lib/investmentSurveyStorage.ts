import type { InvestmentSurveyAnswers, InvestmentSurveyResult } from "./investmentSurvey";

const STORAGE_KEY = (pbId: string, clientId: string) =>
  `pb-investment-survey:${pbId || "default"}:${clientId || "default"}`;

function safeParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function loadInvestmentSurvey(
  pbId: string,
  clientId: string,
): InvestmentSurveyResult | null {
  if (typeof window === "undefined") return null;
  const parsed = safeParse<InvestmentSurveyResult>(
    window.localStorage.getItem(STORAGE_KEY(pbId, clientId)),
  );
  return parsed?.answers ? parsed : null;
}

export function saveInvestmentSurvey(
  pbId: string,
  clientId: string,
  result: InvestmentSurveyResult,
): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY(pbId, clientId), JSON.stringify(result));
}

export function mergeSurveyAnswers(
  saved: InvestmentSurveyResult | null,
): InvestmentSurveyAnswers | null {
  return saved?.answers ?? null;
}
