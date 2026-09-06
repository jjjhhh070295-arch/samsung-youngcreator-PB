import { XMLParser } from "fast-xml-parser";
import { fetchRebIndex, nowYm, monthsBetween } from "./reb-index";

const parser = new XMLParser({
  ignoreAttributes: false,
  parseTagValue: true,
  isArray: (name) => name === "item",
});

// ── 환경변수 읽기 ─────────────────────────────────────────────────────────
// 값이 "있는데 가짜"인 경우를 걸러낸다. 예전에는 "발급받은인증키여기에" 한 문자열만
// 봤는데, .env 에 "[SENSITIVE]" 같은 자리표시자가 들어가 있으면 그대로 통과해 가짜 키로
// API 를 호출했다. 그러면 fetch 가 전부 실패하는데도 "거래 데이터 없음"으로 보고돼
// 원인을 찾을 수 없었다.

const PLACEHOLDER_SECRETS = new Set([
  "발급받은인증키여기에",
  "[sensitive]",
  "[redacted]",
  "your_api_key",
  "your-api-key",
  "changeme",
  "todo",
  "xxx",
]);

/** 쓸 수 있는 값이면 그대로, 비었거나 자리표시자면 null. */
export function readEnvSecret(raw: string | undefined): string | null {
  let value = (raw ?? "").trim();
  // dotenv 가 감싼 따옴표를 벗기지만, 손으로 넣은 값이 남아 있는 경우가 있다.
  if (
    value.length >= 2 &&
    ((value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    value = value.slice(1, -1).trim();
  }
  if (!value) return null;
  if (PLACEHOLDER_SECRETS.has(value.toLowerCase())) return null;
  return value;
}

export const DEFAULT_MOLIT_ENDPOINT =
  "https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev";

/**
 * 엔드포인트 결정. ?? 로는 자리표시자를 못 막는다 — 값이 있기만 하면 통과해서,
 * 정상 기본값을 "[SENSITIVE]" 같은 문자열이 덮어써 버렸다. http(s) URL 로 파싱되는
 * 값만 재정의로 인정하고, 아니면 기본값을 쓴다.
 */
function resolveMolitEndpoint(raw: string | undefined): string {
  const value = readEnvSecret(raw);
  if (!value) return DEFAULT_MOLIT_ENDPOINT;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    // 값 자체는 로그에 남기지 않는다 — 다른 키를 잘못 넣었을 수 있다.
    console.warn(
      `[realestate] MOLIT_APT_TRADE_ENDPOINT 가 URL 이 아니어서 무시하고 기본값을 쓴다 (길이 ${value.length})`,
    );
    return DEFAULT_MOLIT_ENDPOINT;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    console.warn(
      `[realestate] MOLIT_APT_TRADE_ENDPOINT 프로토콜이 ${parsed.protocol} — 무시하고 기본값을 쓴다`,
    );
    return DEFAULT_MOLIT_ENDPOINT;
  }
  return value;
}

/** 국토부 실거래가 인증키. 미설정·자리표시자면 null. */
export function readMolitServiceKey(): string | null {
  return readEnvSecret(process.env.DATA_GO_KR_SERVICE_KEY);
}

export const MOLIT_KEY_MISSING_NOTE =
  "DATA_GO_KR_SERVICE_KEY 미설정 — 국토부 실거래가 조회를 건너뜁니다";

// ── 유틸 ──────────────────────────────────────────────────────────────────

function lastNMonths(n: number): string[] {
  const months: string[] = [];
  const now = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return months;
}

function normalize(s: string) {
  return s
    .replace(/\s+/g, "")
    .replace(/[()（）\-_]/g, "")     // 괄호·특수문자 제거
    .replace(/단지|아파트|APT/gi, "") // 일반 접미사 제거
    .replace(/고층|저층/g, "");       // 동 구분 표기 제거 (고층/저층 분리 단지)
}

function median(arr: number[]) {
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
}

// ── 거래 아이템 타입 ──────────────────────────────────────────────────────

interface TxnItem {
  name:    string;
  area:    number;
  price:   number;
  dealYm:  string; // YYYYMM (국토부 API에서 직접 추출)
}

// ── 신선도 타입 ───────────────────────────────────────────────────────────

export type Freshness = "확정" | "추정" | "참고용";

function determineFreshness(
  newestDealYm: string,
  curYm: string,
  indexAvailable: boolean,
): Freshness {
  const age = monthsBetween(newestDealYm, curYm); // 월 수
  if (age <= 6) return "확정";
  if (age <= 24 && indexAvailable) return "추정";
  return "참고용";
}

// ── 평형별 결과 타입 ──────────────────────────────────────────────────────

export interface AptAreaResult {
  area:            number;          // 전용면적 대표값 (m²)
  pyeong:          number;          // 환산 평형 (정수)
  freshness:       Freshness;
  low:             number | null;   // 시점보정 후 최솟값
  high:            number | null;   // 시점보정 후 최댓값
  median:          number | null;   // 시점보정 후 중앙값
  originalMedian:  number | null;   // 보정 전 중앙값 (추정 시 참고)
  correctionRatio: number | null;   // 평균 보정배율 (currentIdx / dealIdx)
  sampleSize:      number;
  newestDealYm:    string;          // 가장 최근 거래월 YYYYMM
  correctionNote:  string;          // 예: "2024-03 거래 19억→지수보정 21억"
}

// ── 최종 결과 타입 ────────────────────────────────────────────────────────

export interface MarketValueResult {
  // 기존 필드 (하위 호환 유지)
  value:      number | null;
  low:        number | null;
  high:       number | null;
  confidence: "high" | "medium" | "low";
  source:     "molit_realtxn";
  sampleSize: number;
  note:       string;
  connected:  boolean;
  // 신규 필드
  freshness:      Freshness;
  areaBreakdown:  AptAreaResult[];
}

// ── 국토부 XML 파싱 ───────────────────────────────────────────────────────

function extractItems(xml: string): TxnItem[] {
  try {
    const parsed = parser.parse(xml) as {
      response?: { body?: { items?: { item?: unknown[] } } };
    };
    const items = parsed?.response?.body?.items?.item;
    if (!Array.isArray(items)) return [];

    const result: TxnItem[] = [];
    for (const item of items) {
      const row = item as Record<string, unknown>;

      // 해제(취소) 거래 제외
      if (String(row["cdealType"] ?? "").trim() !== "") continue;

      const priceRaw = String(row["dealAmount"] ?? "").replace(/,/g, "").trim();
      const price    = parseFloat(priceRaw) * 10_000;
      const area     = parseFloat(String(row["excluUseAr"] ?? ""));
      const year     = String(row["dealYear"]  ?? "").trim();
      const month    = String(row["dealMonth"] ?? "").trim().padStart(2, "0");

      if (!isFinite(price) || price <= 0 || !isFinite(area) || area <= 0) continue;
      if (year.length !== 4 || month.length !== 2) continue;

      result.push({
        name:   String(row["aptNm"] ?? ""),
        area,
        price,
        dealYm: `${year}${month}`,
      });
    }
    return result;
  } catch {
    return [];
  }
}

/** 한 달치 조회 결과. error 가 있으면 그 달은 "거래 0건"이 아니라 "조회 실패"다. */
interface MonthFetchResult {
  items: TxnItem[];
  error: string | null;
}

async function fetchMonth(
  serviceKey: string,
  endpoint:   string,
  lawdCd:     string,
  dealYmd:    string,
): Promise<MonthFetchResult> {
  const url =
    `${endpoint}?serviceKey=${encodeURIComponent(serviceKey)}` +
    `&LAWD_CD=${lawdCd}&DEAL_YMD=${dealYmd}&numOfRows=1000`;
  try {
    const res = await fetch(url, { next: { revalidate: 3600 } });
    if (!res.ok) {
      const error = `HTTP ${res.status}`;
      console.warn(`[realestate] ${lawdCd}/${dealYmd} 조회 실패 — ${error}`);
      return { items: [], error };
    }
    const xml = await res.text();
    // 국토부 API 성공 코드는 환경에 따라 "00" 과 "000" 이 모두 관측된다. 둘 다 통과시킨다.
    const codeMatch = xml.match(/<resultCode>(\w+)<\/resultCode>/);
    const code = codeMatch?.[1];
    if (code && code !== "00" && code !== "000") {
      const msg = xml.match(/<resultMsg>([^<]*)<\/resultMsg>/)?.[1]?.trim();
      const error = `API 오류 ${code}${msg ? ` (${msg})` : ""}`;
      console.warn(`[realestate] ${lawdCd}/${dealYmd} ${error}`);
      return { items: [], error };
    }
    return { items: extractItems(xml), error: null };
  } catch (e) {
    // 예전에는 여기서 조용히 [] 를 돌려줘, 잘못된 엔드포인트로 전부 실패해도
    // "거래 데이터 없음"으로만 보였다.
    const error = e instanceof Error ? e.message : String(e);
    console.warn(`[realestate] ${lawdCd}/${dealYmd} 조회 예외 — ${error}`);
    return { items: [], error };
  }
}

// ── 평형 그룹화 ───────────────────────────────────────────────────────────
// 면적을 1m² 단위로 반올림 후 ±2m² 이내를 같은 평형으로 묶음

function buildAreaGroups(items: TxnItem[]): Map<number, TxnItem[]> {
  // 1단계: 1m² 단위 버킷
  const raw = new Map<number, TxnItem[]>();
  for (const it of items) {
    const k = Math.round(it.area);
    const arr = raw.get(k) ?? [];
    arr.push(it);
    raw.set(k, arr);
  }

  // 2단계: 2m² 이내 인접 버킷 병합 (작은 키 → 큰 키 순으로 흡수)
  const keys = Array.from(raw.keys()).sort((a, b) => a - b);
  const merged = new Map<number, TxnItem[]>();
  for (const k of keys) {
    let found = false;
    for (const mk of Array.from(merged.keys())) {
      if (Math.abs(k - mk) <= 2) {
        const arr = merged.get(mk)!;
        arr.push(...raw.get(k)!);
        found = true;
        break;
      }
    }
    if (!found) merged.set(k, [...raw.get(k)!]);
  }
  return merged;
}

// ── 시점 보정 ─────────────────────────────────────────────────────────────

interface CorrectedTxn {
  corrected:       number;
  original:        number;
  ratio:           number | null;
  dealYm:          string;
  indexAvailable:  boolean;
}

function correctPrices(
  txns:        TxnItem[],
  indexMap:    Map<string, number>,
  curYm:       string,
): CorrectedTxn[] {
  // 현재 지수: 정확한 현재월 → 없으면 가장 최근 월로 대체
  const curIdx: number | undefined =
    indexMap.get(curYm) ??
    (indexMap.size > 0
      ? Array.from(indexMap.entries())
          .sort((a, b) => b[0].localeCompare(a[0]))[0][1]
      : undefined);

  return txns.map((t) => {
    const dealIdx = indexMap.get(t.dealYm);
    if (!dealIdx || !curIdx) {
      return { corrected: t.price, original: t.price, ratio: null, dealYm: t.dealYm, indexAvailable: false };
    }
    const ratio = curIdx / dealIdx;
    return {
      corrected:      Math.round(t.price * ratio),
      original:       t.price,
      ratio,
      dealYm:         t.dealYm,
      indexAvailable: true,
    };
  });
}

// ── 평형별 결과 산출 ──────────────────────────────────────────────────────

function buildAreaResult(
  areaKey:  number,
  txns:     TxnItem[],
  indexMap: Map<string, number>,
  curYm:    string,
): AptAreaResult {
  const corrected   = correctPrices(txns, indexMap, curYm);
  const newestDealYm = txns
    .map((t) => t.dealYm)
    .sort()
    .at(-1)!;

  const hasIndex   = corrected.some((c) => c.indexAvailable);
  const freshness  = determineFreshness(newestDealYm, curYm, hasIndex);

  const originalPrices  = corrected.map((c) => c.original);
  // 추정만 시점보정 적용; 확정(최근 거래)·참고용(초과 기간) 은 원가격 사용
  const effectivePrices = freshness === "추정"
    ? corrected.map((c) => c.corrected)
    : originalPrices;

  const med     = median(effectivePrices);
  const origMed = median(originalPrices);

  const ratios       = corrected.filter((c) => c.ratio !== null).map((c) => c.ratio!);
  const avgRatio     = ratios.length > 0 ? ratios.reduce((a, b) => a + b, 0) / ratios.length : null;
  const pyeong       = Math.round(areaKey / 3.30579);

  // correctionNote 생성
  let correctionNote = "";
  if (freshness === "추정" && avgRatio !== null) {
    const oldPriceStr = `${Math.round(origMed / 1_0000_0000)}억`;
    const newPriceStr = `${Math.round(med / 1_0000_0000)}억`;
    correctionNote =
      `${newestDealYm.slice(0, 4)}-${newestDealYm.slice(4)} 거래 ${oldPriceStr} → ` +
      `지수보정(×${avgRatio.toFixed(3)}) ${newPriceStr}`;
  } else if (freshness === "참고용") {
    correctionNote = `${newestDealYm.slice(0, 4)}-${newestDealYm.slice(4)} 거래 기준 (24개월 초과, 보정 미적용)`;
  } else {
    correctionNote = `최근 ${txns.length}건 거래 기반 (보정 불필요)`;
  }

  const sorted = [...effectivePrices].sort((a, b) => a - b);

  return {
    area:            areaKey,
    pyeong,
    freshness,
    low:             sorted[0] ?? null,
    high:            sorted[sorted.length - 1] ?? null,
    median:          Math.round(med),
    originalMedian:  Math.round(origMed),
    correctionRatio: avgRatio ? parseFloat(avgRatio.toFixed(4)) : null,
    sampleSize:      txns.length,
    newestDealYm,
    correctionNote,
  };
}

// ── 메인 함수 ─────────────────────────────────────────────────────────────

export async function estimateMarketValue(input: {
  legalDongCode: string;
  complexName:   string;
  /** 없으면 평형을 아직 모른다는 뜻 — 평형별 전체 목록(areaBreakdown)만 반환하고
   *  value/low/high는 null로 둔다("부동산 추가" 2단계: 조회 후 평형 선택 흐름). */
  areaM2?:       number;
  monthsBack?:   number; // default 24 — 시점보정 범위 확보
}): Promise<MarketValueResult> {
  const serviceKey = readMolitServiceKey();
  if (!serviceKey) {
    return {
      value: null, low: null, high: null, confidence: "low",
      source: "molit_realtxn", sampleSize: 0,
      note: MOLIT_KEY_MISSING_NOTE,
      connected: false,
      freshness: "참고용",
      areaBreakdown: [],
    };
  }

  const endpoint = resolveMolitEndpoint(process.env.MOLIT_APT_TRADE_ENDPOINT);

  const monthsBack = input.monthsBack ?? 24;
  const months     = lastNMonths(monthsBack);
  const curYm      = nowYm();

  // ① 거래 데이터 + 지수 병렬 로드
  const [txnResults, indexMap] = await Promise.all([
    Promise.all(months.map((ym) => fetchMonth(serviceKey, endpoint, input.legalDongCode, ym))),
    fetchRebIndex(
      input.legalDongCode,
      months[months.length - 1], // 가장 오래된 달
      curYm,
    ),
  ]);
  const all: TxnItem[] = txnResults.flatMap((r) => r.items);
  const failures = txnResults.filter((r) => r.error);

  // 한 달이라도 성공했으면 API 자체는 살아 있다고 본다. 전부 실패면 연결 실패다 —
  // 이 둘을 구분하지 못해 "거래 데이터 없음"이 잘못된 원인을 가리키고 있었다.
  if (failures.length === txnResults.length) {
    const reason = failures[0]?.error ?? "원인 불명";
    console.warn(
      `[realestate] ${input.legalDongCode} ${monthsBack}개월 조회가 모두 실패 — ${reason}`,
    );
    return {
      value: null, low: null, high: null, confidence: "low",
      source: "molit_realtxn", sampleSize: 0,
      note: `국토부 API 연결 실패 — ${monthsBack}개월 조회가 모두 실패했습니다 (${reason})`,
      connected: false,
      freshness: "참고용",
      areaBreakdown: [],
    };
  }

  const partialNote =
    failures.length > 0 ? ` (${failures.length}/${txnResults.length}개월 조회 실패)` : "";

  if (all.length === 0) {
    return {
      value: null, low: null, high: null, confidence: "low",
      source: "molit_realtxn", sampleSize: 0,
      note: `${input.legalDongCode} 최근 ${monthsBack}개월 거래 데이터 없음${partialNote}`,
      connected: true,
      freshness: "참고용",
      areaBreakdown: [],
    };
  }

  // ② 단지명 필터링
  const normTarget  = normalize(input.complexName);
  const complexTxns = all.filter(
    (t) =>
      normalize(t.name).includes(normTarget) ||
      normTarget.includes(normalize(t.name)),
  );

  if (complexTxns.length === 0) {
    return {
      value: null, low: null, high: null, confidence: "low",
      source: "molit_realtxn", sampleSize: 0,
      note: `단지명 "${input.complexName}" 매칭 거래 없음 (전체 ${all.length}건)`,
      connected: true,
      freshness: "참고용",
      areaBreakdown: [],
    };
  }

  // ③ 평형별 그룹화 + 시점보정
  const areaGroups   = buildAreaGroups(complexTxns);
  const areaBreakdown: AptAreaResult[] = Array.from(areaGroups.entries())
    .map(([areaKey, txns]) => buildAreaResult(areaKey, txns, indexMap, curYm))
    .sort((a, b) => b.area - a.area); // 큰 평형 먼저

  // 평형을 아직 모르면(2단계: 평형 선택 전) 여기서 끝 — 목록만 돌려주고 PB가 고르게 한다.
  if (input.areaM2 == null) {
    return {
      value: null, low: null, high: null, confidence: "low",
      source: "molit_realtxn", sampleSize: 0,
      note: `${areaBreakdown.length}개 평형 거래 확인 — 평형을 선택하세요`,
      connected: true,
      freshness: "참고용",
      areaBreakdown,
    };
  }

  // ④ 대상 평형 (±5% 필터)
  const targetGroup = areaBreakdown.find(
    (r) => Math.abs(r.area - input.areaM2!) / input.areaM2! <= 0.05,
  );

  if (!targetGroup) {
    const areas = areaBreakdown.map((r) => `${r.area}㎡`).join(", ");
    return {
      value: null, low: null, high: null, confidence: "low",
      source: "molit_realtxn", sampleSize: 0,
      note: `${input.areaM2}㎡ 면적 거래 없음 (존재 평형: ${areas})`,
      connected: true,
      freshness: "참고용",
      areaBreakdown,
    };
  }

  const confidence =
    targetGroup.sampleSize >= 3 ? "high"
    : targetGroup.sampleSize >= 1 ? "medium"
    : "low";

  return {
    value:      targetGroup.median,
    low:        targetGroup.low,
    high:       targetGroup.high,
    confidence,
    source:     "molit_realtxn",
    sampleSize: targetGroup.sampleSize,
    note:       targetGroup.correctionNote,
    connected:  true,
    freshness:  targetGroup.freshness,
    areaBreakdown,
  };
}
