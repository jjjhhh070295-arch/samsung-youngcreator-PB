import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 삼성자산운용(KODEX) 인기 ETF — 네이버 금융 ETF 목록 JSON에서 KODEX만 골라 규모(순자산) 상위로.
// 무료/무키. 응답이 EUC-KR이라 직접 디코딩 후 JSON 파싱한다.

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";

export async function GET() {
  try {
    const res = await fetch("https://finance.naver.com/api/sise/etfItemList.naver", {
      headers: { "user-agent": UA },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`naver etf ${res.status}`);
    const text = new TextDecoder("euc-kr").decode(await res.arrayBuffer());
    const json = JSON.parse(text);
    const list: any[] = json?.result?.etfItemList ?? [];

    const items = list
      .filter((e) => /^KODEX/i.test(e.itemname || ""))
      .sort((a, b) => (b.marketSum || 0) - (a.marketSum || 0)) // 순자산총액(규모) 상위
      .slice(0, 6)
      .map((e) => {
        const up = String(e.risefall) === "1" || String(e.risefall) === "2";
        const flat = String(e.risefall) === "3";
        const rate = Number(e.changeRate) || 0;
        return {
          code: e.itemcode,
          name: e.itemname,
          price: Number(e.nowVal) || 0, // 현재가(원)
          changeRate: `${flat ? "" : up ? "+" : "-"}${Math.abs(rate).toFixed(2)}%`,
          up,
          flat,
        };
      });

    return NextResponse.json({ ok: items.length > 0, updatedAt: new Date().toISOString(), items });
  } catch (e: any) {
    console.error("[/api/etf]", e);
    return NextResponse.json({ ok: false, error: e?.message ?? "etf 실패", items: [] });
  }
}
