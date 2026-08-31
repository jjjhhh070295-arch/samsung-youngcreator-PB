// 모닝 브리핑 대상 섹터 — 나중에 늘릴 때 이 배열만 수정하면 된다.
export interface BriefingSector {
  name: string;
  constituents: string; // 종목명(티커) — 프롬프트에 그대로 삽입
}

export const BRIEFING_SECTORS: BriefingSector[] = [
  { name: "반도체/HBM", constituents: "SK하이닉스, 삼성전자, NVDA, TSMC, MU" },
  { name: "전력기기·데이터센터 전력", constituents: "효성중공업, HD현대일렉트릭, GEV, VRT, ETN" },
  { name: "방산·안보SW", constituents: "한화에어로스페이스, PLTR, LMT, RTX" },
  { name: "원전·우라늄", constituents: "두산에너빌리티, CCJ, CEG" },
];
