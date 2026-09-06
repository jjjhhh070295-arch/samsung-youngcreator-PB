import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { toBookHolding } from "./book";
import { SAMPLE_BOOK_CLIENTS, SAMPLE_HANBIT_HOLDINGS } from "./sampleBook";
import type { BookHolding } from "./types";

const LS_KEY = "pb-app-local-holdings-v1";
const SAMPLE_CLIENT_ID = "client-hanbit-cashflow-sample";

function seedHoldings(): BookHolding[] {
  const asOf = "2026-08-18T00:00:00.000Z";
  const source = "local-sample";
  const raw = [
    ...SAMPLE_HANBIT_HOLDINGS,
    ...SAMPLE_BOOK_CLIENTS.flatMap((s) => s.holdings),
  ];
  return raw.map((h) =>
    toBookHolding(
      {
        id: h.id,
        clientId: h.clientId,
        name: h.name,
        ticker: h.ticker,
        market: h.market,
        currency: h.currency,
        quantity: h.quantity,
        avgPrice: h.avgPrice,
        lastPrice: h.lastPrice,
      },
      asOf,
      source,
    ),
  );
}

function loadLocal(): BookHolding[] {
  if (typeof window === "undefined") return seedHoldings();
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as BookHolding[];
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {
    /* ignore */
  }
  const seeded = seedHoldings();
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(seeded));
  } catch {
    /* ignore */
  }
  return seeded;
}

export async function listBookHoldings(clientIds?: string[]): Promise<BookHolding[]> {
  const asOf = new Date().toISOString();
  if (isSupabaseConfigured && supabase) {
    try {
      let q = supabase
        .from("client_holdings")
        .select("id, client_id, name, ticker, market, currency, quantity, avg_price");
      if (clientIds && clientIds.length > 0) q = q.in("client_id", clientIds);
      const { data, error } = await q;
      if (error) throw error;
      // client_holdings 에는 현재가 컬럼이 없다. 예전에는 lastPrice 자리에 avg_price 를
      // 그대로 넣었는데, 그러면 returnPct = (avg - avg)/avg = 정확히 0 이 되어
      //   · 북 화면의 "총수익률"이 전 고객 +0.0% 로 고정되고(수익률이 0이라는 오정보),
      //   · "수익률 저조"(returnPct < 0) 태그가 구조적으로 절대 켜지지 않았다.
      // 시세를 모르면 모른다고 표시하는 게 맞다 — lastPrice·returnPct 를 null 로 둔다.
      // evalAmount 는 evalHolding 이 avgPrice 로 폴백해 계산하므로 그대로 유지된다.
      //
      // toBookHolding 이 내부에서 lastPrice ?? avgPrice 로 다시 메우기 때문에
      // 여기서 반환값을 덮어쓴다. 그 폴백 자체는 book.ts(다른 작업이 점유 중)에 있어
      // 이번에는 건드리지 않았다.
      const rows = (data ?? []).map((r: any) => {
        const holding = toBookHolding(
          {
            id: String(r.id),
            clientId: String(r.client_id ?? r.owner_party_id ?? ""),
            name: r.name,
            ticker: r.ticker ?? null,
            market: r.market ?? null,
            currency: r.currency ?? "KRW",
            quantity: Number(r.quantity ?? 0),
            avgPrice: r.avg_price == null ? null : Number(r.avg_price),
            lastPrice: null,
          },
          asOf,
          "supabase:client_holdings",
        );
        return { ...holding, lastPrice: null, returnPct: null };
      });
      if (rows.length > 0) return rows;
    } catch {
      /* fall through to local sample so 북 화면이 비지 않게 */
    }
  }
  const local = loadLocal();
  if (!clientIds) return local;
  const set = new Set(clientIds);
  const filtered = local.filter((h) => set.has(h.clientId));
  if (filtered.length > 0) return filtered;
  // 한빛 샘플만 있는 경우에도 북이 보이도록
  if (clientIds.includes(SAMPLE_CLIENT_ID)) {
    return local.filter((h) => h.clientId === SAMPLE_CLIENT_ID);
  }
  return filtered;
}
