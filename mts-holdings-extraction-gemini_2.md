# MTS 캡쳐 → 보유자산 자동 추출 (Gemini 기반 빌드 명세 / Claude Code 핸드오프)

> PB 온보딩 시 고객이 증권사 MTS 자산현황 화면을 캡쳐해 올리면,
> Gemini Vision으로 **정적 정보(종목·수량·매입가)만** 추출 → 검수 → Supabase 저장.
> **현재가/평가금액/손익은 저장하지 않고, 화면 표시 시점에 시세 API로 실시간 계산.**
> Stack: Next.js + Supabase + **Google Gemini API (Vision)** + **한국투자증권(KIS) OpenAPI (시세)**
> 입력 언어: 한국어 위주 (국내 MTS). 해외주식(USD) 혼재 가능.

---

## 0. 설계 원칙 (필수)

1. **추출 ≠ 저장.** 자동 저장 금지. 반드시 사용자 검수 테이블을 거친다.
2. **정적 정보만 저장.** 종목명·코드·수량·평균단가만 DB에 저장(거래 전엔 안 변함).
3. **현재가는 저장 금지.** 현재가·평가금액·손익·수익률은 변동값이므로 저장하지 않고,
   화면 표시 시점에 시세 API로 조회해 그 자리에서 계산한다. (저장하면 곧 낡은 값이 됨)
4. **두 프로세스 분리.** ① 캡쳐 추출(Gemini, 적재 시 1회) ② 현재가 조회(표시할 때마다). 섞지 않는다.
5. **시세 소스 추상화.** 현재가 조회는 KIS OpenAPI로 통일(국내·해외 한 소스).
   `PricingProvider` 인터페이스로 감싸 두어, 추후 다른 증권사로 바꿔도 화면·DB는 불변이게 한다.
6. **신뢰도 플래그.** 행별 `confidence: high | medium | low`. low는 UI 하이라이트.
7. **교차검증.** 적재 시 캡쳐에 보이는 현재가로 산술 일관성을 1회 확인(OCR 오류 검출용, 저장은 안 함).
8. **할루시네이션 금지.** 못 읽은 값은 추측 말고 `null`.
9. **민감정보.** 캡쳐 원본은 로그/영구저장 금지. 처리 후 폐기.

---

## 1. ⚠️ Gemini 과금/프라이버시 (실서비스 전 반드시 확인)

- **무료 티어는 프롬프트·응답이 모델 학습에 사용될 수 있음.** → 실제 고객 자산 데이터엔 부적합.
- **개발/테스트: 무료 티어**, **실서비스: 유료 티어(데이터 학습 미사용)** 로 분리.
- 비용 자체는 미미: Flash 입력 100만 토큰당 약 $0.15 → 캡쳐 1장 약 0.5원 미만.
- 주의: 한 프로젝트에 billing을 켜면 그 프로젝트의 무료 티어는 사라진다.
  → **개발용 GCP 프로젝트 / 운영용 프로젝트를 분리**할 것.
- 모델: `gemini-2.5-flash` (안정) 권장. 최신은 `gemini-3-flash`.
  ※ 최신 모델명·요금은 https://ai.google.dev 에서 확인.

---

## 2. 사용자 플로우 (UX)

**[적재 시 — 1회]**
1. **업로드**: 파일/드래그앤드롭/모바일 카메라. **다중 이미지 허용**(스크롤 캡쳐).
2. **분석 중** 로딩.
3. **검수 테이블**: 편집 가능한 표. `low` 신뢰도 셀 노란색, 교차검증 실패 행 빨간색.
4. **사용자 수정/확정**: 행 추가·삭제·수정. (종목·수량·매입가만 확정)
5. **저장**: Supabase `client_holdings` insert (현재가 관련 필드는 저장 안 함).

**[조회 시 — 자산현황 화면 띄울 때마다]**
6. DB에서 보유종목(종목·수량·매입가) 로드.
7. 종목 ticker들을 모아 **시세 서비스에 일괄 조회** → 현재가·환율 수신.
8. 평가금액·손익·수익률을 **그 자리에서 계산**해 표시(저장 X).

---

## 3. API 라우트 (Next.js / App Router)

`POST /api/extract-holdings`
- body: `{ images: { mime_type: string, data: string }[] }` (base64, data URL prefix 제거)
- 흐름: 입력검증 → Gemini 호출 → JSON 파싱 → 교차검증 → 결과 반환

```ts
// app/api/extract-holdings/route.ts
import { NextRequest, NextResponse } from "next/server";
import { EXTRACTION_PROMPT, RESPONSE_SCHEMA } from "@/lib/extraction-config";
import { validateHoldings } from "@/lib/validate-holdings";

const MODEL = "gemini-2.5-flash"; // 운영 전 최신 모델 확인
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

export async function POST(req: NextRequest) {
  try {
    const { images } = await req.json();

    if (!Array.isArray(images) || images.length === 0) {
      return NextResponse.json({ error: "이미지가 없습니다." }, { status: 400 });
    }

    // 이미지 parts 구성 (다중 이미지 지원)
    const imageParts = images.map((img: { mime_type: string; data: string }) => ({
      inline_data: { mime_type: img.mime_type, data: img.data },
    }));

    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": process.env.GEMINI_API_KEY!,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: EXTRACTION_PROMPT }, ...imageParts] }],
        generationConfig: {
          responseMimeType: "application/json", // JSON 강제
          responseSchema: RESPONSE_SCHEMA,      // 스키마 강제
          temperature: 0,                       // 결정적 추출
        },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("Gemini error:", res.status); // 원본 이미지/민감내용 로깅 금지
      return NextResponse.json({ error: "추출 요청 실패" }, { status: 502 });
    }

    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      return NextResponse.json({ error: "응답 파싱 실패" }, { status: 502 });
    }

    const parsed = JSON.parse(text); // 스키마 강제라 코드펜스 제거 불필요
    const result = validateHoldings(parsed); // 서버 교차검증 부착

    return NextResponse.json(result);
  } catch (e) {
    console.error("extract-holdings 실패");
    return NextResponse.json({ error: "서버 오류" }, { status: 500 });
  }
}
```

> 참고: Claude는 `messages`/`image` 블록을 쓰지만, Gemini는 `contents[].parts[]`에
> `inline_data`(snake_case)를 넣는다. 다중 이미지는 같은 parts 배열에 inline_data를 여러 개.

---

## 4. 추출 설정 (프롬프트 + responseSchema)

```ts
// lib/extraction-config.ts

export const EXTRACTION_PROMPT = `당신은 한국 증권사 MTS(키움 영웅문, 삼성 mPOP, 미래에셋,
NH나무, 토스증권, 카카오페이증권 등)의 '보유종목/잔고/자산현황' 캡쳐를 판독하는 추출기다.

[작업]
- 화면에 보이는 보유 종목을 한 행씩 추출한다.
- 국내주식과 해외주식을 구분한다.
- 여러 장의 이미지가 주어지면 종목명 기준으로 중복을 제거하고 병합한다.

[엄격 규칙]
1. 화면에서 확인되지 않는 값은 추측하지 말고 null로 둔다.
2. 숫자가 흐릿하거나 가려져 불확실하면 해당 행 confidence를 "low"로 한다.
3. 콤마/원화기호/% 기호를 제거한 순수 숫자로 변환한다 ("1,234,000원" -> 1234000).
4. 손실(마이너스)은 음수로 표기한다.
5. 국내 종목코드는 6자리 숫자 형식일 때만 ticker에 넣고, 불확실하면 null.

[한국 종목 표기 주의]
- 우선주: "삼성전자우", "현대차2우B" 등 접미사를 종목명에 그대로 보존한다.
- ETF/리츠: "KODEX 200", "TIGER 미국나스닥100" 등 잘림 없이 전체 이름을 보존한다.
- 해외주식: 통화를 USD로, market을 NASDAQ/NYSE 등으로 표기한다.
- NXT/KRX 등 거래소 표기가 보이면 notes에 기록한다.`;

// Gemini responseSchema (OpenAPI subset)
export const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    broker: { type: "string", nullable: true },
    captured_at_visible: { type: "string", nullable: true },
    holdings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          ticker: { type: "string", nullable: true },
          market: { type: "string", nullable: true },          // KOSPI|KOSDAQ|NASDAQ|NYSE|기타
          currency: { type: "string" },                        // KRW|USD
          quantity: { type: "number" },
          avg_price: { type: "number", nullable: true },
          current_price: { type: "number", nullable: true },
          eval_amount: { type: "number", nullable: true },
          pnl_amount: { type: "number", nullable: true },
          return_pct: { type: "number", nullable: true },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          notes: { type: "string", nullable: true },
        },
        required: ["name", "quantity", "currency", "confidence"],
      },
    },
    totals: {
      type: "object",
      properties: {
        eval_amount: { type: "number", nullable: true },
        pnl_amount: { type: "number", nullable: true },
      },
    },
    warnings: { type: "array", items: { type: "string" } },
  },
  required: ["holdings"],
};
```

---

## 5. 서버 교차검증

```ts
// lib/validate-holdings.ts
type Holding = {
  name: string; ticker: string | null; market: string | null; currency: string;
  quantity: number; avg_price: number | null; current_price: number | null;
  eval_amount: number | null; pnl_amount: number | null; return_pct: number | null;
  confidence: "high" | "medium" | "low"; notes: string | null;
  validation?: "ok" | "warn"; // 부착됨
};

const within = (a: number, b: number, pct: number) =>
  b === 0 ? Math.abs(a) < 1 : Math.abs(a - b) / Math.abs(b) <= pct;

export function validateHoldings(parsed: { holdings: Holding[]; warnings?: string[] }) {
  const warnings: string[] = [...(parsed.warnings ?? [])];

  const holdings = (parsed.holdings ?? []).map((h) => {
    let ok = true;

    if (!(h.quantity > 0)) { ok = false; warnings.push(`${h.name}: 수량 비정상`); }

    // 평가금액 ≈ 수량 × 현재가 (오차 1%)
    if (h.eval_amount != null && h.current_price != null &&
        !within(h.eval_amount, h.quantity * h.current_price, 0.01)) {
      ok = false; warnings.push(`${h.name}: 평가금액 불일치`);
    }
    // 평가손익 ≈ (현재가 - 평균단가) × 수량 (오차 1%)
    if (h.pnl_amount != null && h.current_price != null && h.avg_price != null &&
        !within(h.pnl_amount, (h.current_price - h.avg_price) * h.quantity, 0.01)) {
      ok = false; warnings.push(`${h.name}: 평가손익 불일치`);
    }
    // 국내 ticker 형식 보정
    if (h.ticker && !/^\d{6}$/.test(h.ticker)) h.ticker = null;

    return { ...h, validation: ok ? ("ok" as const) : ("warn" as const) };
  });

  return { ...parsed, holdings, warnings };
}
```

> ⚠️ 이 교차검증은 **적재 시 1회**, 캡쳐에 보이는 현재가로 OCR 오류(수량·매입가 오독)를
> 잡기 위한 용도다. 검증이 끝나면 캡쳐의 현재가/평가금액/손익은 **버린다(저장 안 함)**.
> 실제 현재가는 항상 시세 서비스(7번)에서 조회한다.

---

## 6. Supabase 스키마

현재가·평가금액·손익은 **저장하지 않는다**(조회 시 계산). 정적 정보만 보관.

```sql
create table client_holdings (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid references clients(id) not null,
  name          text not null,
  ticker        text,
  market        text,                         -- KOSPI|KOSDAQ|NASDAQ|NYSE|기타
  currency      text not null default 'KRW',  -- KRW|USD
  quantity      numeric not null,
  avg_price     numeric,                      -- 평균단가(정적)
  source        text not null default 'ocr',  -- 'ocr' | 'manual'
  confidence    text,                         -- high|medium|low
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);
-- RLS: client_id 소유자만 접근하도록 정책 설정
-- 주의: current_price/eval_amount/pnl_amount/return_pct 컬럼 없음(의도된 설계).
```

---

## 7. 현재가 시세 조회 서비스 (KIS OpenAPI, 별도 프로세스)

국내·해외를 KIS 한 소스로 통일. **⚠️ 시세 조회(읽기)만 사용. 주문(매매) 엔드포인트는 사용 금지.**
구현 시 정확한 엔드포인트/TR ID/파라미터는 KIS Developers 문서 및 공식 깃허브
(github.com/koreainvestment/open-trading-api)에서 확인할 것.

### 7-0. 사전 준비
- KIS 계좌 개설 → KIS Developers에서 앱키(APP KEY)/시크릿 발급
- 모의투자(모의도메인)로 먼저 테스트 후 실전 도메인 전환
- 도메인: 실전/모의 base URL이 다름. env로 분리.

### 7-1. 인터페이스 (고정 계약)
```ts
// lib/pricing/types.ts
export interface PriceQuote {
  ticker: string;
  price: number | null;       // 조회 실패 시 null
  currency: "KRW" | "USD";
  as_of: string;              // 시세 기준 시각(ISO)
  source: "kis";
  stale: boolean;             // 장마감/지연 등으로 실시간이 아님
}
export interface PricingProvider {
  getQuotes(tickers: { ticker: string; currency: "KRW" | "USD" }[]): Promise<PriceQuote[]>;
  getFxUsdKrw(): Promise<number>;   // USD→KRW 환율
}
```

### 7-2. 토큰 관리 (OAuth 토큰 캐싱)
KIS는 앱키/시크릿으로 접근토큰을 발급받고, 토큰은 일정 시간 후 만료된다.
**매 요청마다 새로 발급하지 말 것**(발급 자체에도 호출 제한이 있음). 발급한 토큰을
만료 직전까지 재사용하고, 만료가 임박하면 자동 갱신한다.

```ts
// lib/pricing/kis-token.ts
let cached: { token: string; expiresAt: number } | null = null;

export async function getKisToken(): Promise<string> {
  // 만료 60초 전이면 재사용
  if (cached && Date.now() < cached.expiresAt - 60_000) return cached.token;

  const res = await fetch(`${process.env.KIS_BASE_URL}/oauth2/tokenP`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      appkey: process.env.KIS_APP_KEY,
      appsecret: process.env.KIS_APP_SECRET,
    }),
  });
  const data = await res.json();
  // expires_in(초) 기준으로 만료시각 계산
  cached = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return cached.token;
}
```
> 서버 인스턴스가 여러 개면 토큰을 Supabase/Redis에 공유 저장 권장(중복 발급 방지).

### 7-3. 시세 조회 (배치 + 결과 캐싱 + rate limit 방어)
- **결과 캐싱**: 같은 종목을 60초 내 다시 조회하면 캐시값 반환(중복 호출 차단).
- **rate limit 방어**: KIS는 초당 호출 제한이 있음 → 종목별 호출 사이에 간격(throttle)을
  두고, 동시 호출 수를 제한(예: 동시 2~3건). 대량 종목은 순차 처리.
- KIS 국내 현재가 TR과 해외 현재가 TR은 엔드포인트/파라미터가 다름 → 통화로 분기.

```ts
// lib/pricing/kis-provider.ts
import { getKisToken } from "./kis-token";
import type { PricingProvider, PriceQuote } from "./types";

const cache = new Map<string, { quote: PriceQuote; at: number }>();
const TTL = 60_000;            // 결과 캐시 60초
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchOne(t: { ticker: string; currency: "KRW" | "USD" }): Promise<PriceQuote> {
  const hit = cache.get(t.ticker);
  if (hit && Date.now() - hit.at < TTL) return hit.quote;

  const token = await getKisToken();
  const isDomestic = t.currency === "KRW";

  // ⚠️ 아래 path / tr_id / query는 KIS 문서 기준으로 교체할 것 (국내/해외 상이)
  const url = isDomestic
    ? `${process.env.KIS_BASE_URL}/uapi/domestic-stock/v1/quotations/inquire-price?FID_COND_MRKT_DIV_CODE=J&FID_INPUT_ISCD=${t.ticker}`
    : `${process.env.KIS_BASE_URL}/uapi/overseas-price/v1/quotations/price?...&SYMB=${t.ticker}`;

  try {
    const res = await fetch(url, {
      headers: {
        authorization: `Bearer ${token}`,
        appkey: process.env.KIS_APP_KEY!,
        appsecret: process.env.KIS_APP_SECRET!,
        tr_id: isDomestic ? "FHKST01010100" : "<해외 TR ID>", // 문서 확인
      },
    });
    const data = await res.json();
    // 응답 필드명은 국내/해외 다름 → 문서 기준 매핑
    const priceStr = isDomestic ? data?.output?.stck_prpr : data?.output?.last;
    const price = priceStr != null ? Number(priceStr) : null;

    const quote: PriceQuote = {
      ticker: t.ticker, price, currency: t.currency,
      as_of: new Date().toISOString(), source: "kis",
      stale: isMarketClosed(t.currency), // 장 시간 외면 true
    };
    cache.set(t.ticker, { quote, at: Date.now() });
    return quote;
  } catch {
    return { ticker: t.ticker, price: null, currency: t.currency,
             as_of: new Date().toISOString(), source: "kis", stale: true };
  }
}

export const kisProvider: PricingProvider = {
  async getQuotes(tickers) {
    const out: PriceQuote[] = [];
    // 동시 호출 제한: 한 번에 3건씩, 묶음 사이 간격
    const BATCH = 3;
    for (let i = 0; i < tickers.length; i += BATCH) {
      const chunk = tickers.slice(i, i + BATCH);
      out.push(...(await Promise.all(chunk.map(fetchOne))));
      if (i + BATCH < tickers.length) await sleep(300); // throttle
    }
    return out;
  },
  async getFxUsdKrw() {
    // KIS 환율 TR 또는 별도 환율 소스. 캐시 권장(분 단위면 충분).
    return 1380; // placeholder — 실제 조회로 교체
  },
};

function isMarketClosed(_cur: "KRW" | "USD"): boolean {
  // 국내/미국 장 시간 판별. 간단히 시작은 true 고정 후 추후 정교화 가능.
  return false;
}
```

> 핵심 3종 세트가 다 들어감: **토큰 캐싱**(7-2) + **배치/throttle**(getQuotes) + **결과 캐싱**(cache).
> 종목 수가 많아져도 rate limit에 안 걸리고, 화면도 빠르게 뜬다.

### 7-4. 조회 시 계산 (화면 표시용, 저장 안 함)
```ts
// lib/pricing/compute.ts
export function computeRow(h: { quantity: number; avg_price: number | null; currency: "KRW"|"USD" },
                          quote: { price: number | null }, fxUsdKrw: number) {
  if (quote.price == null) return { evalAmount: null, pnl: null, returnPct: null, priced: false };
  const evalLocal = h.quantity * quote.price;
  const evalKrw = h.currency === "USD" ? evalLocal * fxUsdKrw : evalLocal;
  const pnl = h.avg_price != null ? (quote.price - h.avg_price) * h.quantity : null;
  const returnPct = h.avg_price ? (quote.price - h.avg_price) / h.avg_price * 100 : null;
  return { evalAmount: evalKrw, pnl, returnPct, priced: true };
}
```
> 시세 조회 실패한 종목은 평가금액 빈칸 + "시세 조회 실패" 표시(0으로 처리 금지).

---

## 8. 환경변수

```
GEMINI_API_KEY=...     # 서버 전용. NEXT_PUBLIC_ 금지
KIS_BASE_URL=...       # 실전/모의 도메인 (env로 분리)
KIS_APP_KEY=...        # 서버 전용
KIS_APP_SECRET=...     # 서버 전용
KIS_ACCOUNT_NO=...     # 계좌번호(시세만 쓰면 불필요할 수 있음, 문서 확인)
```
> 모든 KIS 키는 서버 전용. 절대 클라이언트(NEXT_PUBLIC_) 노출 금지.

---

## 9. 엣지 케이스 / 테스트 체크리스트

타겟 증권사 캡쳐 2~3장으로 우선 검증:

- [ ] 우선주: "삼성전자우", "현대차2우B" 종목명 보존
- [ ] 긴 ETF/리츠명: "TIGER 미국나스닥100" 잘림 없음
- [ ] 해외주식(USD): currency=USD, market 구분, 환율 적용 후 KRW 환산
- [ ] 스크롤 다중 캡쳐: 종목명 기준 병합·중복 제거
- [ ] 잔액 숨김/블러 화면: 해당 값 null + confidence low
- [ ] 종목코드 없는 화면: ticker null → 시세 조회 불가 → "코드 미확인" 표시
- [ ] 마이너스 수익: 음수 정상 처리
- [ ] 무관한 이미지: holdings 빈 배열 + warning
- [ ] **시세 조회 실패 종목: 평가금액 빈칸 + 실패 표시(0 처리 금지)**
- [ ] **장 마감/주말: stale=true 표시(종가 기준임을 사용자에게 알림)**

---

## 10. 구현 우선순위

1. API 라우트 + 프롬프트 + responseSchema + 단일 이미지 추출 (MVP)
2. Supabase 저장(정적 정보만) + 검수 테이블 UI
3. **KIS 토큰 발급·캐싱(7-2)** — 모의투자 도메인으로 먼저
4. **KIS 국내 시세 조회 + 배치/throttle + 결과 캐싱(7-3)**
5. **조회 시 평가/손익 실시간 계산 + 화면 표시(7-4)**
6. **KIS 해외 시세 + 환율 적용**(USD 종목)
7. 다중 이미지 병합
8. 종목마스터 매핑으로 ticker 자동 보정(시세 조회 정확도↑)
9. 운영 전환: KIS 실전 도메인 전환 + 유료 GCP 프로젝트 분리 + Gemini 데이터 학습 미사용 확인
