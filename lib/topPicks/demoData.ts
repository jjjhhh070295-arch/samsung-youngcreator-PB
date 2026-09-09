const scoreSets = [
  [94, 91, 88, 92, 90], [92, 89, 94, 87, 91], [88, 93, 86, 90, 84],
  [90, 85, 92, 82, 88], [86, 90, 84, 89, 82], [84, 88, 81, 86, 85],
  [89, 83, 87, 84, 80], [82, 87, 85, 83, 86], [85, 82, 89, 81, 83], [83, 86, 80, 85, 84],
] as const;

const stocks = [
  ["000660", "SK하이닉스", "SEMICONDUCTOR", "GROWTH", null, true, "HBM 수요와 실적 추정치 상향이 리서치 점수를 견인했습니다."],
  ["005930", "삼성전자", "SEMICONDUCTOR", "CORE", 4, false, "메모리 업황 회복과 다수 증권사 목표가 상향이 확인됐습니다."],
  ["012450", "한화에어로스페이스", "DEFENSE", "MOMENTUM", 2, false, "수주 가시성과 상대강도가 높은 수준을 유지하고 있습니다."],
  ["005380", "현대차", "AUTO", "CORE", 6, false, "이익 체력과 밸류에이션 매력이 함께 반영됐습니다."],
  ["035420", "NAVER", "INTERNET", "GROWTH", 7, false, "AI 서비스 확장과 이익 전망 개선이 점수에 기여했습니다."],
  ["105560", "KB금융", "FINANCIAL", "DEFENSIVE", 3, false, "안정적 이익과 주주환원 특성이 방어 점수를 높였습니다."],
  ["207940", "삼성바이오로직스", "BIO", "GROWTH", 9, false, "수주 성장과 실적 가시성이 높은 신뢰도로 반영됐습니다."],
  ["034020", "두산에너빌리티", "ENERGY", "MOMENTUM", null, true, "원전 수주 기대와 가격 모멘텀이 동시에 개선됐습니다."],
  ["000270", "기아", "AUTO", "CORE", 8, false, "견조한 수익성과 낮은 변동성이 균형을 이뤘습니다."],
  ["068270", "셀트리온", "BIO", "GROWTH", 10, false, "신제품 매출 기대와 컨센서스 개선이 확인됐습니다."],
] as const;

export function demoDashboardHome() {
  const topPicks = stocks.map((stock, index) => {
    const [ticker, company, sector, type, previousRank, isNew, summary] = stock;
    const [research, fundamental, price, consensus, regime] = scoreSets[index];
    const score = Math.round((research * .4 + fundamental * .25 + price * .15 + consensus * .15 + regime * .05) * 10) / 10;
    return { rank: index + 1, previousRank, rankChange: previousRank == null ? null : previousRank - (index + 1), isNew, ticker, company, market: "KR", sector, themes: sector === "SEMICONDUCTOR" ? ["AI", "HBM"] : [sector], score, confidence: 94 - index, type, summary, keyReasons: [summary, "여러 점수 축이 기준선을 동시에 충족했습니다."], risks: ["시장 변동성과 실적 추정치 하향 가능성을 점검해야 합니다."], scores: { research, fundamental, price, consensus, regime }, breakdown: {} };
  });
  return { demo: true, ready: true, date: "DEMO", marketBrief: { headline: "반도체 실적 기대가 이어지는 가운데 금리와 환율 변동성에 주목", summary: "최근 2주간 AI·반도체 실적 기대가 강화됐고, 최근 3일에는 금리 경로와 달러 움직임이 위험선호의 핵심 변수로 부상했습니다. 오늘은 실적 추정치가 개선되는 업종을 중심으로 보되 단기 급등 종목은 선별적으로 접근합니다.", timeline: { twoWeeks: "AI 서버 투자와 HBM 수요 전망이 상향되며 반도체 이익 추정치가 개선됐습니다.", threeDays: "미국 장기금리 반등과 달러 강세가 성장주 밸류에이션 부담으로 다시 부각됐습니다.", today: "실적 개선이 확인되는 종목을 우선하되 금리·환율 민감도가 높은 종목은 분산 접근이 필요합니다." }, indicators: [{ label: "KOSPI", value: "2,745.1", change: "+0.8%" }, { label: "S&P 500", value: "5,621.3", change: "+0.4%" }, { label: "US 10Y", value: "4.18%", change: "+0.03%p" }, { label: "USD/KRW", value: "1,368.2", change: "-0.2%" }], issues: [{ title: "AI 반도체 실적 추정치 상향", summary: "HBM과 데이터센터 수요가 관련 기업의 이익 전망을 지지하고 있습니다.", whatChanged: "주요 기업의 EPS와 목표주가가 최근 리포트에서 연속 상향됐습니다.", marketImpact: "반도체 대형주의 상대강도 우위가 이어질 수 있습니다.", watchPoint: "단기 급등 이후 변동성과 외국인 수급" }, { title: "미국 금리 경로 재평가", summary: "장기금리 반등이 성장주의 단기 변동성을 높일 수 있습니다.", whatChanged: "인하 기대가 일부 후퇴하며 미국 10년물 금리가 반등했습니다.", marketImpact: "고밸류 성장주의 할인율 부담이 커질 수 있습니다.", watchPoint: "물가·고용 지표와 연준 발언" }, { title: "원화 변동성", summary: "외국인 수급과 수출주 환산 실적에 미치는 영향을 함께 점검합니다.", whatChanged: "원/달러 환율의 일중 변동 폭이 확대됐습니다.", marketImpact: "외국인 수급과 업종별 실적 환산 효과가 엇갈릴 수 있습니다.", watchPoint: "1,370원 부근 방향성과 수출주 수급" }], themes: [{ theme: "SEMICONDUCTOR", themeKo: "반도체", score: .9, direction: "POSITIVE", reason: "실적 추정치 상향" }, { theme: "DEFENSE", themeKo: "방산", score: .7, direction: "POSITIVE", reason: "수주 가시성" }, { theme: "AUTO", themeKo: "자동차", score: .3, direction: "POSITIVE", reason: "수익성 방어" }, { theme: "SECONDARY_BATTERY", themeKo: "2차전지", score: -.4, direction: "NEGATIVE", reason: "수요 회복 지연" }], watchPoints: ["미국 10년물 금리", "원/달러 환율", "외국인 반도체 수급"], assetView: { equity: "실적 개선 업종 중심", bond: "듀레이션 중립", usd: "변동성 점검" } }, topPicks };
}

export function demoTopPickDetail(ticker: string) {
  const home = demoDashboardHome();
  const pick = home.topPicks.find((item) => item.ticker === ticker);
  if (!pick) return null;
  const base = pick.score;
  const history = Array.from({ length: 8 }, (_, index) => ({ trade_date: `DEMO-${String(index + 1).padStart(2, "0")}`, total_score: Math.round((base - 4 + index * .7) * 10) / 10, confidence_score: pick.confidence, rank: Math.max(1, pick.rank + (index < 4 ? 2 : 0)) }));
  return { ...pick, date: "DEMO", score: pick.score, history, research: [{ published_at: "DEMO", rating: "BUY", previous_rating: "HOLD", target_price: null, previous_target_price: null, eps_revision_pct: 8.2, investment_points: pick.keyReasons, risk_factors: pick.risks, themes: pick.themes, research_documents: { title: "로컬 UI 동작 확인용 리서치", source: "DEMO", broker: "DEMO", analyst: null, source_url: null } }], inputSnapshot: { demo: true }, sourceDocumentIds: [], priceChart: null };
}
