import type { Client, Consultation, IPS } from "@/lib/types";
import type { BookHolding } from "./types";

function factor(
  value: string,
  score: number,
  evidence: string,
): IPS["return"] {
  return {
    value,
    score,
    notes: "북 대시보드 시연용 샘플",
    source: "manual",
    status: "explicit",
    evidence,
    inferenceHint: "",
    reviewed: true,
  };
}

function ips(partial: Partial<IPS>): IPS {
  const base: IPS = {
    return: factor("연 6~8%", 3, "목표 수익 언급"),
    risk: factor("중위험", 3, "위험 감내 보통"),
    timeHorizon: factor("3년 이상", 3, "중기"),
    tax: factor("절세 관심", 3, "세금 일정"),
    liquidity: factor("중유동성", 3, "생활비 외 여유"),
    legal: factor("특이규제 없음", 2, "일반"),
    unique: factor("VVIP 개인", 3, "다고객"),
  };
  return { ...base, ...partial };
}

export interface SampleBookSeed {
  client: Client;
  consultations: Consultation[];
  holdings: Array<Omit<BookHolding, "evalAmount" | "returnPct" | "category" | "asOf" | "source"> & {
    lastPrice: number | null;
  }>;
}

const PB = "pb-demo-youngcreator";
const AS_OF = "2026-08-18T00:00:00.000Z";

export const SAMPLE_BOOK_CLIENTS: SampleBookSeed[] = [
  {
    client: {
      id: "client-book-seojin",
      code: "C-2026-1101",
      clientType: "individual",
      name: "김서진",
      birthDate: "1978-03-12",
      assignedPbId: PB,
      assetSize: 8_600_000_000,
      consultationNotes: "해외주식 선호. 기대수익률 연 12% 이상. 개별주식도 일부 편입 희망. 상속 대비 유동성 필요.",
      ips: ips({
        return: factor("연 12% 이상", 4, "기대수익률 12% 이상"),
        risk: factor("적극", 4, "변동성 감수"),
        liquidity: factor("상속세 재원 분리", 4, "2년 내 일부 현금화"),
        unique: factor("해외주식 선호, 개별주식 선호", 4, "해외·개별주"),
      }),
      cashFlows: [
        { id: "sj-1", label: "생활비", amount: -18_000_000, date: "2026-08", recurring: true },
        { id: "sj-2", label: "증여세 예상", amount: -420_000_000, date: "2027-03", recurring: false },
      ],
      portfolios: [],
      stages: { basic: true, factors: true, cashflow: true },
      createdAt: AS_OF,
    },
    consultations: [
      {
        id: "cons-seojin-1",
        clientId: "client-book-seojin",
        pbId: PB,
        startedAt: "2026-08-12T01:00:00.000Z",
        endedAt: "2026-08-12T02:10:00.000Z",
        durationSeconds: 4200,
        notes: "해외 ETF 코어 + 개별주 위성. 신탁은 보류.",
        ipsSnapshot: ips({ risk: factor("적극", 4, "변동성 감수") }),
        createdAt: "2026-08-12T02:10:00.000Z",
      },
    ],
    holdings: [
      { id: "h-sj-1", clientId: "client-book-seojin", name: "KODEX 미국S&P500", ticker: "379800", market: "KRX", currency: "KRW", quantity: 12000, avgPrice: 15200, lastPrice: 16840 },
      { id: "h-sj-2", clientId: "client-book-seojin", name: "NVIDIA", ticker: "NVDA", market: "NASDAQ", currency: "USD", quantity: 80, avgPrice: 120, lastPrice: 178 },
      { id: "h-sj-3", clientId: "client-book-seojin", name: "삼성전자", ticker: "005930", market: "KRX", currency: "KRW", quantity: 2500, avgPrice: 72000, lastPrice: 78100 },
      { id: "h-sj-4", clientId: "client-book-seojin", name: "KODEX 단기채권", ticker: "273130", market: "KRX", currency: "KRW", quantity: 8000, avgPrice: 108200, lastPrice: 109050 },
    ],
  },
  {
    client: {
      id: "client-book-doyun",
      code: "C-2026-1102",
      clientType: "individual",
      name: "박도윤",
      birthDate: "1989-11-02",
      assignedPbId: PB,
      assetSize: 2_400_000_000,
      consultationNotes: "개별주식만 선호. 최근 손실 구간. 위험등급 높음.",
      ips: ips({
        return: factor("연 20% 이상", 5, "고수익 요구"),
        risk: factor("공격", 5, "손실 감수 의사"),
        liquidity: factor("낮음", 2, "당장 현금 필요 적음"),
        unique: factor("개별주식 선호, 다른 상품 제외 요청", 5, "주식 올인"),
      }),
      cashFlows: [{ id: "dy-1", label: "급여 잉여자금", amount: 8_000_000, date: "2026-08", recurring: true }],
      portfolios: [],
      stages: { basic: true, factors: true },
      createdAt: AS_OF,
    },
    consultations: [
      {
        id: "cons-doyun-1",
        clientId: "client-book-doyun",
        pbId: PB,
        startedAt: "2026-07-20T04:00:00.000Z",
        endedAt: "2026-07-20T04:40:00.000Z",
        durationSeconds: 2400,
        notes: "손실 구간 리밸런싱 필요. 집중 리스크 경고.",
        ipsSnapshot: ips({ risk: factor("공격", 5, "손실 감수") }),
        createdAt: "2026-07-20T04:40:00.000Z",
      },
    ],
    holdings: [
      { id: "h-dy-1", clientId: "client-book-doyun", name: "NVIDIA", ticker: "NVDA", market: "NASDAQ", currency: "USD", quantity: 40, avgPrice: 210, lastPrice: 178 },
      { id: "h-dy-2", clientId: "client-book-doyun", name: "테슬라", ticker: "TSLA", market: "NASDAQ", currency: "USD", quantity: 60, avgPrice: 280, lastPrice: 198 },
      { id: "h-dy-3", clientId: "client-book-doyun", name: "에코프로", ticker: "086520", market: "KOSDAQ", currency: "KRW", quantity: 800, avgPrice: 620000, lastPrice: 410000 },
    ],
  },
  {
    client: {
      id: "client-book-chaewon",
      code: "C-2026-1103",
      clientType: "sole_proprietor",
      name: "이채원",
      birthDate: "1971-06-08",
      assignedPbId: PB,
      assetSize: 5_100_000_000,
      consultationNotes: "종합소득세·부가세 납부 일정 집중. 유동성 부족. 신탁만 고려하고 싶다는 언급.",
      ips: ips({
        return: factor("원금 보전 우선, 연 4~6%", 2, "안정 수익"),
        risk: factor("안정추구", 2, "손실 민감"),
        tax: factor("종합소득·부가세 일정", 5, "세금 최우선"),
        liquidity: factor("6개월 내 세금 납부", 5, "납부재원 분리"),
        unique: factor("신탁만 고려", 4, "신탁/랩 희망"),
      }),
      cashFlows: [
        { id: "cw-1", label: "종합소득세", amount: -380_000_000, date: "2026-05", recurring: false },
        { id: "cw-2", label: "부가세", amount: -90_000_000, date: "2026-10", recurring: false },
        { id: "cw-3", label: "사업소득", amount: 42_000_000, date: "2026-08", recurring: true },
      ],
      portfolios: [],
      stages: { basic: true, factors: true, cashflow: true },
      createdAt: AS_OF,
    },
    consultations: [
      {
        id: "cons-chaewon-1",
        clientId: "client-book-chaewon",
        pbId: PB,
        startedAt: "2026-08-05T06:00:00.000Z",
        endedAt: "2026-08-05T07:00:00.000Z",
        durationSeconds: 3600,
        notes: "세금 납부 전 환금성 점검. 신탁 안정형 위주 요청.",
        ipsSnapshot: ips({ liquidity: factor("6개월 내 세금", 5, "납부재원") }),
        createdAt: "2026-08-05T07:00:00.000Z",
      },
    ],
    holdings: [
      { id: "h-cw-1", clientId: "client-book-chaewon", name: "삼성증권 일임형 랩 성장", ticker: null, market: "WRAP", currency: "KRW", quantity: 1, avgPrice: 2_800_000_000, lastPrice: 2_610_000_000 },
      { id: "h-cw-2", clientId: "client-book-chaewon", name: "KODEX AI반도체핵심장비", ticker: "395160", market: "KRX", currency: "KRW", quantity: 4000, avgPrice: 14200, lastPrice: 12100 },
      { id: "h-cw-3", clientId: "client-book-chaewon", name: "CMA", ticker: null, market: "CASH", currency: "KRW", quantity: 1, avgPrice: 180_000_000, lastPrice: 181_000_000 },
    ],
  },
  {
    client: {
      id: "client-book-sejinbio",
      code: "C-2026-1104",
      clientType: "corporate",
      name: "세진바이오(주)",
      birthDate: "2009-01-15",
      assignedPbId: PB,
      assetSize: 12_800_000_000,
      consultationNotes: "법인 여유자금. ELS/ELB와 채권 중심. 법인세 일정 있음.",
      ips: ips({
        return: factor("연 5~7% 세후 효율", 3, "중수익"),
        risk: factor("위험중립", 3, "중간"),
        tax: factor("법인세 납부", 4, "3월 법인세"),
        liquidity: factor("운영자금 3개월", 4, "운영자금 분리"),
        unique: factor("법인, ELS와 채권 선호", 3, "구조화+채권"),
      }),
      cashFlows: [
        { id: "sb-1", label: "법인세 예상", amount: -920_000_000, date: "2027-03", recurring: false },
        { id: "sb-2", label: "금융소득", amount: 28_000_000, date: "2026-08", recurring: true },
      ],
      portfolios: [],
      stages: { basic: true, factors: true, cashflow: true, portfolio: false },
      createdAt: AS_OF,
    },
    consultations: [
      {
        id: "cons-sejin-1",
        clientId: "client-book-sejinbio",
        pbId: PB,
        startedAt: "2026-08-14T02:30:00.000Z",
        endedAt: "2026-08-14T03:20:00.000Z",
        durationSeconds: 3000,
        notes: "ELB 만기 롤오버와 단기채 래더 검토.",
        ipsSnapshot: ips({ tax: factor("법인세", 4, "3월") }),
        createdAt: "2026-08-14T03:20:00.000Z",
      },
    ],
    holdings: [
      { id: "h-sb-1", clientId: "client-book-sejinbio", name: "삼성증권 ELB 원금부분보장형", ticker: null, market: "OTC", currency: "KRW", quantity: 1, avgPrice: 2_000_000_000, lastPrice: 2_040_000_000 },
      { id: "h-sb-2", clientId: "client-book-sejinbio", name: "국고채 3년", ticker: "KR103501", market: "KRX", currency: "KRW", quantity: 1, avgPrice: 3_500_000_000, lastPrice: 3_470_000_000 },
      { id: "h-sb-3", clientId: "client-book-sejinbio", name: "KODEX 단기채권", ticker: "273130", market: "KRX", currency: "KRW", quantity: 15000, avgPrice: 108000, lastPrice: 109050 },
      { id: "h-sb-4", clientId: "client-book-sejinbio", name: "KODEX 미국S&P500", ticker: "379800", market: "KRX", currency: "KRW", quantity: 6000, avgPrice: 14900, lastPrice: 16840 },
    ],
  },
];

export const SAMPLE_HANBIT_HOLDINGS: SampleBookSeed["holdings"] = [
  { id: "h-hb-1", clientId: "client-hanbit-cashflow-sample", name: "KODEX 단기채권", ticker: "273130", market: "KRX", currency: "KRW", quantity: 20000, avgPrice: 108000, lastPrice: 109050 },
  { id: "h-hb-2", clientId: "client-hanbit-cashflow-sample", name: "KODEX 미국S&P500", ticker: "379800", market: "KRX", currency: "KRW", quantity: 8000, avgPrice: 15000, lastPrice: 16840 },
  { id: "h-hb-3", clientId: "client-hanbit-cashflow-sample", name: "삼성전자", ticker: "005930", market: "KRX", currency: "KRW", quantity: 5000, avgPrice: 69000, lastPrice: 78100 },
  { id: "h-hb-4", clientId: "client-hanbit-cashflow-sample", name: "삼성증권 일임형 랩 균형", ticker: null, market: "WRAP", currency: "KRW", quantity: 1, avgPrice: 4_200_000_000, lastPrice: 4_380_000_000 },
];
