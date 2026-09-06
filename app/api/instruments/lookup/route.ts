// GET /api/instruments/lookup?q=... — 종목명·티커로 종목코드를 찾는 대화형 검색.
//
// 왜 /api/instruments/search 를 재사용하지 않는가:
//   ① 그쪽은 결과 50건마다 withQuote() 로 시세를 붙인다. 자동완성처럼 타이핑 중
//      호출되는 경로에서는 한 번 입력에 시세 API 가 수십 번 나간다.
//   ② assetClass 파라미터가 필수라 없으면 400 이다. 보유종목에는 자산군 개념이 없다.
//   ③ matchesClass 가 domesticEquity 에서 "미국·글로벌" 단어가 든 종목을 빼는 등
//      포트폴리오 구성 화면 전용 규칙을 적용한다.
// 역할이 다르므로 라우트를 나눈다. 여기는 "이름 → 코드"만 하고 시세는 손대지 않는다
// (시세는 기존 KIS 경로 /api/prices 가 그대로 담당한다).
//
// 정적 맵(lib/pricing/ticker-map.ts)은 327개뿐이고 2026-06-21 이후 갱신된 적이 없어
// 중소형주·신규상장이 통째로 빠져 있다(두산퓨얼셀·범한퓨얼셀·니어스랩 전부 없음).
// 네이버 자동완성은 전 상장 종목에 더해 해외 종목까지 덮는다. 다만 비공식
// 엔드포인트라 언제든 형식이 바뀔 수 있어, 실패하면 정적 맵으로 폴백하고 어느 쪽을
// 썼는지 source 로 알린다.

import { NextResponse } from "next/server";
import { lookupTicker } from "@/lib/pricing/ticker-map";
import { toHits, type LookupHit } from "@/lib/instruments/lookup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NAVER_HEADERS = {
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
  referer: "https://m.stock.naver.com/",
};

async function searchNaver(query: string): Promise<LookupHit[]> {
  // 비공식 엔드포인트가 응답하지 않을 때 라우트가 매달리지 않게 끊는다.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(
      `https://ac.stock.naver.com/ac?q=${encodeURIComponent(query)}&target=stock,marketindicator,index`,
      { headers: NAVER_HEADERS, cache: "no-store", signal: controller.signal },
    );
    if (!res.ok) throw new Error(`네이버 검색 응답 ${res.status}`);
    return toHits(await res.json());
  } finally {
    clearTimeout(timer);
  }
}

/** 네이버가 죽었을 때의 폴백. 정적 맵은 국내 보통주만, 그것도 327개만 안다. */
function searchStatic(query: string): LookupHit[] {
  const code = lookupTicker(query);
  if (!code) return [];
  return [
    { code, name: query.trim(), market: "KRX", nation: "KOR", currency: "KRW", kind: "보통주" },
  ];
}

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  // 1글자는 후보가 과도하게 넓어 고르는 데 도움이 안 된다.
  if (query.length < 2) {
    return NextResponse.json({ ok: true, source: "none", results: [] });
  }

  try {
    const results = await searchNaver(query);
    // 네이버가 붙긴 했는데 0건이면 정적 맵도 본다. 맵에만 있는 표기(예: "포스코홀딩스")가
    // 자동완성에서 안 잡히는 경우를 위해서다.
    if (results.length === 0) {
      const fallback = searchStatic(query);
      if (fallback.length > 0) {
        return NextResponse.json({ ok: true, source: "static", results: fallback });
      }
    }
    return NextResponse.json({ ok: true, source: "naver", results });
  } catch (e: any) {
    // 네이버 실패로 사용자 입력 흐름을 끊을 이유가 없다. 정적 맵으로 낮춰 잡고,
    // 어느 쪽 결과인지 source 로 알려 UI 가 한계를 표시하게 한다.
    console.warn("[/api/instruments/lookup] 네이버 실패 — 정적 맵 폴백:", e?.message ?? e);
    return NextResponse.json({
      ok: true,
      source: "static",
      results: searchStatic(query),
      warning: "실시간 검색에 연결하지 못해 간이 목록에서 찾았습니다.",
    });
  }
}
