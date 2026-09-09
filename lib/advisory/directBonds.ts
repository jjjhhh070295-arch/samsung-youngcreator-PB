/**
 * 채권형 자산: ETF가 아닌 직접투자 가능 채권만 추천.
 * 회차·쿠폰·만기를 확인할 수 없는 이름은 넣지 않는다.
 * SpaceX 등 해외 회사채는 매매·실재성 검증 실패 시 제외(blocked).
 */

export type BondVerificationStatus = "verified" | "review" | "blocked";

export interface DirectBondInstrument {
  id: string;
  name: string;
  /** 표시용 만기 (확정 만기일 또는 지표물 잔존만기 설명) */
  maturity: string;
  /** 표시용 쿠폰 */
  coupon: string;
  currency: "KRW" | "USD";
  /** 신용등급 또는 위험등급 */
  creditOrRisk: string;
  asOf: string;
  source: string;
  role: string;
  taxNote: string;
  status: BondVerificationStatus;
  /** ETF 여부 — true면 절대 고객 최종안에 넣지 않음 */
  isEtf: boolean;
}

/**
 * 검증된 직접투자형 채권 카탈로그.
 * - 국고채/통안채/산금채/한전채 등은 국내 PB가 직접매매 가능한 상품군.
 * - 특정 미확인 회차 번호는 만들지 않고, 지표물·공시된 만기·쿠폰 체계로 표기.
 * - status !== verified 또는 isEtf 인 항목은 최종 포트폴리오 자동 반영 금지.
 */
export const DIRECT_BOND_CATALOG: DirectBondInstrument[] = [
  {
    id: "ktb-3y-benchmark",
    name: "국고채 3년 지표물 (직접투자)",
    maturity: "잔존만기 약 3년 (KRX 국채 지표물 롤링)",
    coupon: "지표물 유통수익률 적용 · 편입 시점 확정 쿠폰",
    currency: "KRW",
    creditOrRisk: "국채 (신용위험 사실상 없음)",
    asOf: "2026-08-21",
    source: "한국거래소(KRX) 국채 · 금융투자협회 채권정보센터",
    role: "세금 납부·만기매칭 코어 금리자산",
    taxNote: "이자소득 과세 · 매매차익 과세 여부 세무 확인",
    status: "verified",
    isEtf: false,
  },
  {
    id: "ktb-10y-benchmark",
    name: "국고채 10년 지표물 (직접투자)",
    maturity: "잔존만기 약 10년 (KRX 국채 지표물 롤링)",
    coupon: "지표물 유통수익률 적용 · 편입 시점 확정 쿠폰",
    currency: "KRW",
    creditOrRisk: "국채 (신용위험 사실상 없음)",
    asOf: "2026-08-21",
    source: "한국거래소(KRX) 국채 · 금융투자협회 채권정보센터",
    role: "듀레이션 분산 · 장기 금리 인컴",
    taxNote: "이자소득 과세 · 금리 상승 시 평가손실",
    status: "verified",
    isEtf: false,
  },
  {
    id: "msb-1y",
    name: "통안채(통화안정증권) 1년물 (직접투자)",
    maturity: "발행 만기 약 1년 (한국은행 통안증권)",
    coupon: "할인·이표는 발행회차 공시 기준",
    currency: "KRW",
    creditOrRisk: "한국은행 발행 · 초단기 국공채성",
    asOf: "2026-08-21",
    source: "한국은행 통화안정증권 · 금융투자협회 채권정보센터",
    role: "단기 금리 · 유동성 완충",
    taxNote: "이자소득 과세",
    status: "verified",
    isEtf: false,
  },
  {
    id: "kdb-bankbond",
    name: "산금채(산업금융채권) 우량만기 (직접투자)",
    maturity: "잔존만기 2~5년 래더 (편입 시 개별 종목 확정)",
    coupon: "발행이표 · 편입 종목 공시 기준",
    currency: "KRW",
    creditOrRisk: "한국산업은행 보증성 · 통상 AAA~AA급 준하는 공기업채",
    asOf: "2026-08-21",
    source: "한국산업은행 · 금융투자협회 채권정보센터",
    role: "국공채 대비 스프레드 인컴",
    taxNote: "이자소득 과세 · 신용·유동성 스프레드 확인",
    status: "verified",
    isEtf: false,
  },
  {
    id: "kepco-bond",
    name: "한전채(한국전력공사채) 우량만기 (직접투자)",
    maturity: "잔존만기 3~7년 래더 (편입 시 개별 종목 확정)",
    coupon: "발행이표 · 편입 종목 공시 기준",
    currency: "KRW",
    creditOrRisk: "한국전력공사 · 통상 AA급 이상 공기업채(편입 시 등급 재확인)",
    asOf: "2026-08-21",
    source: "한국전력공사 공시 · 금융투자협회 채권정보센터",
    role: "공기업채 인컴 보완",
    taxNote: "이자소득 과세 · 신용등급 변동 모니터링",
    status: "verified",
    isEtf: false,
  },
  {
    id: "aa-corp-ladder",
    name: "국내 AA- 이상 우량 회사채 래더 (직접투자)",
    maturity: "1~5년 만기분산 (편입 시 개별 종목·ISIN 확정)",
    coupon: "종목별 이표 · 편입 공시 기준",
    currency: "KRW",
    creditOrRisk: "AA- 이상 (편입 시점 국내 신용평가사 등급)",
    asOf: "2026-08-21",
    source: "금융투자협회 채권정보센터 · 국내 신용평가사 공시",
    role: "만기매칭 인컴 래더",
    taxNote: "이자소득·법인 회계 처리 확인",
    status: "verified",
    isEtf: false,
  },
  {
    id: "brazil-local-gov",
    name: "브라질 국채(헤알화) 만기분산 (직접투자 검토)",
    maturity: "편입 시 개별 만기 확정",
    coupon: "현지통화 이표 · 편입 시 확정",
    currency: "USD", // settlement often via USD; mark review
    creditOrRisk: "국가신용·환율 위험 · 조세조약 요건 세무 확인",
    asOf: "2026-08-21",
    source: "브라질 재무부/증권 공시 · 조세조약 검토 필요",
    role: "조세조약상 이자 비과세 검토 후보",
    taxNote: "환율·국가위험·조세조약 요건 세무 확인 전 고객 최종안 자동 반영 금지",
    status: "review",
    isEtf: false,
  },
  {
    id: "spacex-corp-unverified",
    name: "SpaceX 회사채 (미검증)",
    maturity: "확인 불가",
    coupon: "확인 불가",
    currency: "USD",
    creditOrRisk: "실재성·매매가능·등급 미확인",
    asOf: "2026-08-21",
    source: "미확인 — 자동 추천 금지",
    role: "해외 회사채 후보(차단)",
    taxNote: "검증 실패",
    status: "blocked",
    isEtf: false,
  },
];

export function isBondEtfName(name: string): boolean {
  return /ETF|KODEX|TIGER|ACE|SOL|KOSEF|ARIRANG|HANARO/i.test(name);
}

export function formatDirectBondDisplay(bond: DirectBondInstrument): string {
  return [
    bond.name,
    `만기 ${bond.maturity}`,
    `쿠폰 ${bond.coupon}`,
    `통화 ${bond.currency}`,
    `신용/위험 ${bond.creditOrRisk}`,
    `as-of ${bond.asOf}`,
    `출처 ${bond.source}`,
  ].join(" · ");
}

export function selectVerifiedDirectBonds(options?: {
  taxPriority?: boolean;
  maxCount?: number;
}): DirectBondInstrument[] {
  const maxCount = options?.maxCount ?? 4;
  const verified = DIRECT_BOND_CATALOG.filter((b) => b.status === "verified" && !b.isEtf);
  if (options?.taxPriority) {
    // 세금 우선: 국고·통안·산금·우량회사채
    const order = ["ktb-3y-benchmark", "msb-1y", "aa-corp-ladder", "kdb-bankbond"];
    return order
      .map((id) => verified.find((b) => b.id === id))
      .filter((b): b is DirectBondInstrument => Boolean(b))
      .slice(0, maxCount);
  }
  // 한전채(kepco-bond)는 레거시 직접회사채 대표와 혼동되므로 자동 추천 순서에서 제외한다.
  // 신규 회사채 노출은 ACE/LQD 등 실제 채권 ETF 카탈로그(ManualPortfolioBuilder)를 사용한다.
  const order = ["ktb-3y-benchmark", "ktb-10y-benchmark", "msb-1y", "aa-corp-ladder"];
  return order
    .map((id) => verified.find((b) => b.id === id))
    .filter((b): b is DirectBondInstrument => Boolean(b))
    .slice(0, maxCount);
}
