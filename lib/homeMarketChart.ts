const NAVER_HEADERS = {
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
  referer: "https://m.stock.naver.com/",
};

export interface HomeChartResult {
  points: { time: string; value: number }[];
  prevClose: number | null;
  delayMinutes: number;
  startTime: string | null;
  endTime: string | null;
}

interface NaverKospiBasic {
  closePrice?: string;
  compareToPreviousClosePrice?: string;
  stockExchangeType?: { delayTime?: number };
}

interface NaverKospiMinute {
  localDateTime?: string;
  currentPrice?: number;
}

function parseNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const parsed = Number(value.replace(/[,%+\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function minuteLabel(value: string) {
  if (!/^\d{12,14}$/.test(value)) return null;
  return `${value.slice(8, 10)}:${value.slice(10, 12)}`;
}

export async function fetchNaverKospiIntraday(): Promise<HomeChartResult> {
  const [basicResponse, minuteResponse] = await Promise.all([
    fetch("https://m.stock.naver.com/api/index/KOSPI/basic", {
      headers: NAVER_HEADERS,
      cache: "no-store",
    }),
    fetch("https://api.stock.naver.com/chart/domestic/index/KOSPI/minute", {
      headers: NAVER_HEADERS,
      cache: "no-store",
    }),
  ]);
  if (!basicResponse.ok || !minuteResponse.ok) {
    throw new Error(`KOSPI ${basicResponse.status}/${minuteResponse.status}`);
  }

  const basic = await basicResponse.json() as NaverKospiBasic;
  const rows = await minuteResponse.json() as NaverKospiMinute[];
  const points = rows
    .map((row) => ({
      time: typeof row.localDateTime === "string" ? minuteLabel(row.localDateTime) : null,
      value: parseNumber(row.currentPrice),
    }))
    .filter((point): point is { time: string; value: number } => point.time != null && point.value != null);
  if (points.length === 0) throw new Error("KOSPI 분봉 데이터가 없습니다.");

  const close = parseNumber(basic.closePrice);
  const change = parseNumber(basic.compareToPreviousClosePrice);
  const previousClose = close != null && change != null ? close - change : null;
  const delay = Number(basic.stockExchangeType?.delayTime ?? 0);
  return {
    points,
    prevClose: previousClose != null && previousClose > 0 ? previousClose : null,
    delayMinutes: Number.isFinite(delay) ? delay : 0,
    startTime: points[0].time,
    endTime: points[points.length - 1].time,
  };
}
