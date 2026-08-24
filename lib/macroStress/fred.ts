import snapshotJson from "./fred-snapshot.json";

export type FredPoint = { date: string; value: number };
export type FredSeriesResult = {
  points: FredPoint[];
  source: string;
  fallback: boolean;
};

type FredLoadOptions = {
  fresh?: boolean;
};

type SnapshotShape = {
  generatedAt: string;
  series: Record<string, FredPoint[]>;
};

const snapshot = snapshotJson as SnapshotShape;
const UA = "Mozilla/5.0 macro-stress/3.0";
const TIMEOUT_MS = 10_000;

function validPoints(points: FredPoint[], startDate: string) {
  return points.filter(
    (point) => point.date >= startDate && Number.isFinite(Number(point.value)),
  );
}

async function fromOfficialApi(
  seriesId: string,
  startDate: string,
  fresh: boolean,
): Promise<FredPoint[]> {
  const apiKey = process.env.FRED_API_KEY?.trim();
  if (!apiKey) throw new Error("FRED_API_KEY is not configured");
  const query = new URLSearchParams({
    series_id: seriesId,
    api_key: apiKey,
    file_type: "json",
    observation_start: startDate,
  });
  const cacheOptions: RequestInit = fresh
    ? { cache: "no-store" }
    : { next: { revalidate: 86_400 } };
  const response = await fetch(
    `https://api.stlouisfed.org/fred/series/observations?${query.toString()}`,
    {
      ...cacheOptions,
      headers: { "user-agent": UA, accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    },
  );
  if (!response.ok) throw new Error(`FRED API ${seriesId}: HTTP ${response.status}`);
  const payload: { observations?: Array<{ date: string; value: string }> } = await response.json();
  return validPoints(
    (payload.observations ?? []).map((row) => ({ date: row.date, value: Number(row.value) })),
    startDate,
  );
}

async function fromFredGraph(seriesId: string, startDate: string): Promise<FredPoint[]> {
  const response = await fetch(
    `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(seriesId)}&cosd=${startDate}`,
    {
      headers: { "user-agent": UA, accept: "text/csv" },
      next: { revalidate: 86_400 },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    },
  );
  if (!response.ok) throw new Error(`FRED CSV ${seriesId}: HTTP ${response.status}`);
  return validPoints(
    (await response.text()).trim().split(/\r?\n/).slice(1).map((line) => {
      const [date, raw] = line.split(",");
      return { date, value: Number(raw) };
    }),
    startDate,
  );
}

export async function loadFredSeries(
  seriesId: string,
  startDate: string,
  options: FredLoadOptions = {},
): Promise<FredSeriesResult> {
  if (process.env.FRED_API_KEY?.trim()) {
    try {
      const points = await fromOfficialApi(seriesId, startDate, options.fresh === true);
      if (points.length) return { points, source: `FRED API ${seriesId}`, fallback: false };
    } catch {
      // 공식 API 장애 시 배포에 포함된 스냅샷으로 계속 진행한다.
    }
  }

  // Vercel에서 fredgraph.csv가 반복적으로 타임아웃되어 로컬 갱신 때만 사용한다.
  if (!process.env.VERCEL) {
    try {
      const points = await fromFredGraph(seriesId, startDate);
      if (points.length) return { points, source: `FRED CSV ${seriesId}`, fallback: false };
    } catch {
      // 네트워크가 없어도 스냅샷으로 실행한다.
    }
  }

  const points = validPoints(snapshot.series[seriesId] ?? [], startDate);
  if (!points.length) throw new Error(`FRED ${seriesId}: no API or snapshot observations`);
  return {
    points,
    source: `FRED snapshot ${seriesId} (${snapshot.generatedAt.slice(0, 10)})`,
    fallback: true,
  };
}
