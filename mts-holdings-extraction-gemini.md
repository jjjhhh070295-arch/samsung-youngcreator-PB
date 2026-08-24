# MTS 캡쳐 → 보유자산 자동 추출 (Gemini 기반 빌드 명세 / Claude Code 핸드오프)

> PB 온보딩 시 고객이 증권사 MTS 자산현황 화면을 캡쳐해 올리면,
> Gemini Vision으로 구조화 JSON을 추출 → 검수 → Supabase 저장 → RRTTLLU 엔진 연결.
> Stack: Next.js + Supabase + **Google Gemini API (Vision)**
> 입력 언어: 한국어 위주 (국내 MTS). 해외주식 일부 혼재 가능.

---

## 0. 설계 원칙 (필수)

1. **추출 ≠ 저장.** 자동 저장 금지. 반드시 사용자 검수 테이블을 거친다.
2. **신뢰도 플래그.** 행별 `confidence: high | medium | low`. low는 UI 하이라이트.
3. **교차검증.** 산술 일관성(평가금액 ≈ 수량 × 현재가)으로 OCR 오류를 서버에서 검출.
4. **할루시네이션 금지.** 못 읽은 값은 추측 말고 `null`.
5. **민감정보.** 캡쳐 원본은 로그/영구저장 금지. 처리 후 폐기.

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

1. **업로드**: 파일/드래그앤드롭/모바일 카메라. **다중 이미지 허용**(스크롤 캡쳐).
2. **분석 중** 로딩.
3. **검수 테이블**: 편집 가능한 표. `low` 신뢰도 셀 노란색, 교차검증 실패 행 빨간색.
4. **사용자 수정/확정**: 행 추가·삭제·수정.
5. **저장**: 확정 시 Supabase `client_holdings` insert → RRTTLLU 연결.

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

> 현재가/평가금액은 캡쳐 시점값이라 부정확할 수 있음 → 저장 후 pykrx/KIS로 현재가
> 재조회하는 보정 단계를 별도 권장(이미 보유 중인 데이터 수집 시스템과 연결).

---

## 6. Supabase 스키마

```sql
create table client_holdings (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid references clients(id) not null,
  name          text not null,
  ticker        text,
  market        text,
  currency      text not null default 'KRW',
  quantity      numeric not null,
  avg_price     numeric,
  current_price numeric,
  eval_amount   numeric,
  pnl_amount    numeric,
  return_pct    numeric,
  source        text not null default 'ocr',  -- 'ocr' | 'manual'
  confidence    text,                         -- high|medium|low
  created_at    timestamptz default now()
);
-- RLS: client_id 소유자만 접근하도록 정책 설정
```

---

## 7. 환경변수

```
GEMINI_API_KEY=...   # 서버 전용. 절대 클라이언트 노출 금지(NEXT_PUBLIC_ 접두사 X)
```

---

## 8. 엣지 케이스 / 테스트 체크리스트

타겟 증권사 캡쳐 2~3장으로 우선 검증:

- [ ] 우선주: "삼성전자우", "현대차2우B" 종목명 보존
- [ ] 긴 ETF/리츠명: "TIGER 미국나스닥100" 잘림 없음
- [ ] 해외주식(USD): currency=USD, market 구분
- [ ] 스크롤 다중 캡쳐: 종목명 기준 병합·중복 제거
- [ ] 잔액 숨김/블러 화면: 해당 값 null + confidence low
- [ ] 종목코드 없는 화면: ticker null (추후 종목마스터 매핑)
- [ ] 마이너스 수익: 음수 정상 처리
- [ ] 무관한 이미지: holdings 빈 배열 + warning

---

## 9. 구현 우선순위

1. API 라우트 + 프롬프트 + responseSchema + 단일 이미지 (MVP)
2. 검수 테이블 UI (편집 + 신뢰도/검증 하이라이트)
3. 다중 이미지 병합
4. 현재가 재조회 보정(pykrx/KIS)
5. 종목마스터 매핑으로 ticker 자동 보정
6. 운영 전환 시: 유료 GCP 프로젝트 분리 + 데이터 학습 미사용 확인
