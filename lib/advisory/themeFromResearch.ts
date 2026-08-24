/**
 * 리포트 기반 테마 판정 — LLM은 테마명/근거 추출만.
 * heuristic(회사개요만으로 pass) 제거.
 */

export type ThemeStatus = "pass" | "review" | "blocked";

export interface ThemeSourceDoc {
  title: string;
  publisher: string;
  publishedAt: string; // ISO or YYYY-MM-DD
  url: string;
}

export interface ThemeJudgement {
  status: ThemeStatus;
  themeName: string;
  reportCount: number;
  confidence: number;
  evidence: string[];
  sources: ThemeSourceDoc[];
  asOf: string;
  /** UI: 리포트상 중기 테마 근거 충분/부족 */
  summaryLabel: string;
}

function withinDays(iso: string, days: number, now = new Date()): boolean {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return false;
  return now.getTime() - t <= days * 86_400_000;
}

function validSource(s: ThemeSourceDoc): boolean {
  return Boolean(s.title?.trim() && s.publisher?.trim() && s.publishedAt?.trim() && /^https?:\/\//i.test(s.url || ""));
}

/**
 * 최근 90일 문서 2개 이상 + URL/발행일 유효 → pass
 * 1개 → review, 0 → blocked
 */
export function judgeThemeFromReports(input: {
  themeName?: string;
  evidence?: string[];
  sources: ThemeSourceDoc[];
  asOf?: string;
  now?: Date;
}): ThemeJudgement {
  const asOf = input.asOf ?? new Date().toISOString();
  const recent = input.sources.filter((s) => validSource(s) && withinDays(s.publishedAt, 90, input.now));
  const reportCount = recent.length;
  const themeName = input.themeName?.trim() || "테마 미확정";
  const evidence = (input.evidence ?? []).filter(Boolean);

  if (reportCount >= 2) {
    return {
      status: "pass",
      themeName,
      reportCount,
      confidence: Math.min(0.95, 0.55 + reportCount * 0.1),
      evidence: evidence.length ? evidence : recent.map((s) => `${s.title} (${s.publisher})`),
      sources: recent,
      asOf,
      summaryLabel: "리포트상 중기 테마 근거 충분",
    };
  }
  if (reportCount === 1) {
    return {
      status: "review",
      themeName,
      reportCount,
      confidence: 0.35,
      evidence: evidence.length ? evidence : [`단일 출처: ${recent[0].title}`],
      sources: recent,
      asOf,
      summaryLabel: "리포트상 중기 테마 근거 부족 (문서 1건)",
    };
  }
  return {
    status: "blocked",
    themeName: "테마 근거 없음",
    reportCount: 0,
    confidence: 0,
    evidence: ["최근 90일 내 URL·발행일이 확인되는 리포트/공시가 없습니다."],
    sources: [],
    asOf,
    summaryLabel: "리포트상 중기 테마 근거 부족",
  };
}
