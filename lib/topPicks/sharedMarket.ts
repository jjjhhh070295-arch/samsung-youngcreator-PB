import type { ReportAnalysis } from "@/lib/researchAnalysis";

export type SavedMorningBrief = {
  report_date: string;
  headline: string;
  text_body: string;
  model: string;
  status: string;
};
export type SavedResearchAnalysis = {
  report_id: string;
  title: string;
  source: string;
  url: string;
  date: string | null;
  summary: string;
  signals: ReportAnalysis["signals"];
  model: string;
};

// 이미 생성된 브리핑·본문 분석을 그대로 재사용한다. 홈 조회는 LLM을 호출하지 않는다.
export function sharedMarketBrief(morning: SavedMorningBrief | null, rows: SavedResearchAnalysis[]) {
  const research = rows.filter((row) => row.model && row.model !== "dummy" && row.summary?.trim());
  if (!morning && !research.length) return null;
  const dates = [morning?.report_date, ...research.map((row) => row.date)].filter((date): date is string => Boolean(date));
  return {
    date: dates.sort().at(-1) ?? null,
    headline: morning?.headline || "최신 리서치 분석",
    summary: morning?.text_body?.slice(0, 1600) || research.slice(0, 3).map((row) => row.summary).join("\n\n"),
    sourceLabel: morning ? `모닝 브리핑 · ${morning.report_date}${morning.status === "draft" ? " · 초안" : ""} / 리서치 탭` : "리서치 탭 분석",
    model: Array.from(new Set([morning?.model, ...research.map((row) => row.model)].filter(Boolean))).join(" / "),
    indicators: [],
    issues: research.slice(0, 3).map((row) => ({ title: row.title, summary: row.summary, source: row.source, url: row.url, date: row.date })),
    themes: [],
    watchPoints: [],
  };
}
