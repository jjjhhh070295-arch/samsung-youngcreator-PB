// 국내 종목 기업개요 — 와이즈에프엔(WiseReport) 기업현황 페이지에서 읽는다.
//
// ── 왜 새 소스인가 ─────────────────────────────────────────────────────────
// 원래는 fetchNaverProfile(naver.ts)이 finance.naver.com/item/main.naver 의
// #summary_info(에프앤가이드 제공 기업개요)를 긁었다. 네이버가 종목 페이지를
// stock.naver.com(Npay 증권)으로 옮기면서 옛 주소는 리다이렉트되고, 새 페이지에는
// 그 블록도 "기업개요"라는 글자도 없다. 그 뒤로 국내 종목은 개요가 전부 비었다.
//
// 네이버 새 페이지의 기업정보 탭은 WiseReport 기업현황(c1010001)을 iframe 으로
// 띄운다. 그 원본을 직접 읽는다. 에프앤가이드가 아니라 와이즈에프엔이 쓴 문구라
// 예전 네이버 화면과 글자까지 같지는 않다 — 출처 표기도 그래서 WiseReport 로 한다.
//
// ── fetchNaverProfile 을 고치지 않은 이유 ─────────────────────────────────
// 그 함수는 kr-trend(국내 트렌드 필터)도 쓴다. 거기서는 원문이 40자 이상이어야
// 테마 판정을 통과시키는데, 지금은 원문이 비어 최종 후보가 항상 0건이다. 그 함수의
// 소스를 바꾸면 Portfolio Customizing 화면의 후보가 조용히 달라진다. 그래서 이 함수는
// 티커분석 경로(tickerOhlcData.fetchTickerProfile)에서만 쓴다.
//
// ── 절대 던지지 않는다 ──────────────────────────────────────────────────────
// /api/ticker/ohlc 는 시세·프로필·재무를 Promise.all 로 함께 받는다. 여기서 예외가
// 나면 시세·차트까지 502 로 막힌다. 그래서 모든 실패를 잡아 warning 으로 돌려준다.
// 조용히 비우지 않고 사유를 남긴다 — ohlc 라우트가 그 warning 을 snapshot.warnings 에
// 넣어 화면 경고로 띄운다. 응답이 늘어지면 시세까지 같이 기다리게 되므로 타임아웃을 건다.
//
// v2 와 v3 는 본문이 같다(국내 9개 종목 대조, 글자까지 일치). v3 는 네이버 iframe 용
// 테마 파라미터가 붙는 주소라 v2 를 쓴다.

import type { YahooProfile } from "./yahoo";

const SOURCE = "wisereport:c1010001:company-overview";
const TIMEOUT_MS = 8_000;
const HEADERS = {
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
  referer: "https://stock.naver.com/",
};

/** 개요 자리에 본문 대신 들어오는 안내 문구. 원문으로 취급하면 안 된다. */
const NO_DATA_TEXT = /^해당\s*자료가\s*없습니다\.?$/;

function decodeEntities(value: string) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function htmlToText(value: string) {
  return decodeEntities(value.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 기업현황 페이지의 기업개요 문장을 이어 붙인다. 없으면 "".
 *
 * 개요는 `<div class="cmp_comment">` 바로 안의 `<ul class="dot_cmp">` 목록이고, 문장마다
 * `<li class="dot_cmp">` 다. 그 목록의 li.dot_cmp 만 받는다. 범위를 이렇게 좁힌 이유는
 * 실측에서 둘 다 틀린 값이 들어왔기 때문이다:
 *   · ETF(KODEX200)는 이 자리에 목록 대신 상품설명 <div> 가 오고, 다음 </ul> 은 한참 뒤
 *     NAV 추이 섹션에 있다. 아무 li 나 받으면 "일간 주간 월간 순자산가치…" 같은 화면 UI
 *     문구가 기업개요로 들어갔다.
 *   · 리츠(롯데리츠)는 목록은 있는데 `<li>해당 자료가 없습니다.</li>` 하나뿐이다(dot_cmp
 *     클래스 없음). 이걸 원문으로 받으면 warning 없이 안내 문구가 개요로 나갔다.
 */
function extractSummary(html: string): string {
  const start = html.search(/class=["'][^"']*\bcmp_comment\b[^"']*["']/i);
  if (start < 0) return "";
  const tail = html.slice(start, start + 8_000);

  // 목록이 cmp_comment 안에 있어야 한다 — 첫 </div> 보다 뒤에 나오는 목록은 다른 섹션이다.
  const listStart = tail.search(/<ul[^>]*class=["'][^"']*\bdot_cmp\b[^"']*["']/i);
  const firstDivClose = tail.indexOf("</div>");
  if (listStart < 0 || (firstDivClose >= 0 && firstDivClose < listStart)) return "";

  const listEnd = tail.indexOf("</ul>", listStart);
  const list = listEnd > listStart ? tail.slice(listStart, listEnd) : tail.slice(listStart);
  return Array.from(list.matchAll(/<li[^>]*class=["'][^"']*\bdot_cmp\b[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi))
    .map((match) => htmlToText(match[1]))
    .filter((text) => text && !NO_DATA_TEXT.test(text))
    .join(" ");
}

export async function fetchWiseReportProfile(code: string): Promise<YahooProfile> {
  const asOf = new Date().toISOString();
  const failed = (warning: string): YahooProfile => ({
    asOf,
    source: SOURCE,
    sector: null,
    industry: null,
    longBusinessSummary: null,
    warning,
  });

  if (!/^[0-9A-Z]{6}$/i.test(code)) {
    return failed(`국내 기업개요를 조회하지 않았습니다 — 종목코드 형식이 아닙니다 (${code}).`);
  }

  try {
    const res = await fetch(
      `https://navercomp.wisereport.co.kr/v2/company/c1010001.aspx?cmp_cd=${encodeURIComponent(code)}`,
      { headers: HEADERS, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) },
    );
    if (!res.ok) {
      return failed(`국내 기업개요 조회 실패 (WiseReport HTTP ${res.status})`);
    }
    const contentType = res.headers.get("content-type")?.toLowerCase() ?? "";
    const encoding = contentType.includes("euc-kr") ? "euc-kr" : "utf-8";
    const html = new TextDecoder(encoding).decode(await res.arrayBuffer());
    const summary = extractSummary(html);
    if (!summary) {
      // ETF·ETN 은 기업개요 대신 상품설명만 있고, 리츠 등은 "해당 자료가 없습니다" 만 있다.
      // 존재하지 않는 코드는 페이지 자체가 비어 온다.
      return failed("WiseReport 기업현황에 기업개요 본문이 없습니다 (ETF·리츠 등은 제공되지 않습니다).");
    }
    return {
      asOf,
      source: SOURCE,
      sector: null,
      industry: null,
      longBusinessSummary: summary,
      warning: null,
    };
  } catch (e: unknown) {
    const name = e instanceof Error ? e.name : "";
    const reason =
      name === "TimeoutError" || name === "AbortError"
        ? `${TIMEOUT_MS / 1000}초 안에 응답이 없습니다`
        : e instanceof Error && e.message
          ? e.message
          : "네트워크 오류";
    return failed(`국내 기업개요 조회 실패 (WiseReport: ${reason})`);
  }
}
