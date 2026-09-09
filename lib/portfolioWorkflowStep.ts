/**
 * 포트폴리오 워크플로 UI 단계 — 승인/계산 상태와 무관한 화면 페이징만 담당.
 */

export const PORTFOLIO_WORKFLOW_STEPS = ["allocation", "instruments", "approval"] as const;
export type PortfolioWorkflowStep = (typeof PORTFOLIO_WORKFLOW_STEPS)[number];

export const PORTFOLIO_STEP_META: Record<
  PortfolioWorkflowStep,
  { index: number; label: string; description: string }
> = {
  allocation: {
    index: 1,
    label: "자산배분",
    description: "투자가능자산 기준으로 자산군 비중을 확정합니다.",
  },
  instruments: {
    index: 2,
    label: "종목선택",
    description: "자산군별 편입 종목과 내부 비중을 확정합니다.",
  },
  approval: {
    index: 3,
    label: "포트폴리오승인",
    description: "미리보기·분석·세전·세후를 확인한 뒤 승인합니다.",
  },
};

export function parsePortfolioWorkflowStep(raw: string | null | undefined): PortfolioWorkflowStep {
  if (raw === "instruments" || raw === "approval" || raw === "allocation") return raw;
  // 레거시 숫자·별칭
  if (raw === "2" || raw === "instrument") return "instruments";
  if (raw === "3" || raw === "review" || raw === "tax") return "approval";
  if (raw === "1") return "allocation";
  return "allocation";
}

export function portfolioWorkflowHref(
  pbId: string,
  clientId: string,
  step: PortfolioWorkflowStep,
  opts?: { hash?: string },
): string {
  const base = `/pb/${pbId}/${clientId}?view=analysis&tab=portfolio2&portfolioStep=${step}`;
  return opts?.hash ? `${base}#${opts.hash}` : base;
}
