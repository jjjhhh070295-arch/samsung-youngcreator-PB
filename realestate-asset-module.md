# 부동산 자산 모듈 빌드 명세 (Claude Code 핸드오프)

> PB 고객의 부동산 자산을 입력·평가해 순자산/투자가능자산/LTV/임대수익률을 산출하고
> RRTTLLU 엔진으로 넘긴다. 주식(MTS 캡쳐) 모듈과 달리 단일 캡쳐로 안 되며,
> "등기부 추출 + 주소기반 API 조회 + 수동 보완"의 3-way 혼합 입력을 쓴다.
> Stack: Next.js + Supabase + Gemini(등기부 추출) + 공공 부동산 API

---

## 0. 설계 원칙 (필수)

1. **자산-부채 짝맞춤.** 부동산은 연결부채(주담대)와 반드시 함께 잡아 순자산을 계산.
2. **시세는 숫자가 아니라 "범위 + 출처 + 신뢰도".** 단일 확정값 금지.
3. **용도별 base 분리.** 자산배분=시세, 종부세/재산세=공시가격, 양도세=취득가.
4. **실거주 vs 투자 분리.** 실거주 주택은 투자가능자산(investable)에서 제외.
5. **추출 ≠ 저장.** 등기부/시세 자동값은 검수 후 저장.

---

## 1. 데이터 소스 (용도별 역할 분담)

| 소스 | 역할 | 한계 |
|---|---|---|
| 국토부 실거래가 API | 개별 물건 시세 추정(같은 단지 최근 거래) | 지역+기간 조회 → 단지/면적 필터 필요. 최근 거래 없으면 공백 |
| 공시가격(공동주택가격) | 세금 base(종부세·재산세) | 시세보다 낮음. 평가시세 아님 |
| 한국부동산원 통계 API | **지역 동향 보조지표**(가격지수 추세) | 개별 물건 가격 아님. 부가 위젯용 |
| 등기부등본(고객 업로드) | 소유권·지분·근저당(부채) 추출 | PDF 판독. Gemini 사용 |
| (향후) KB시세 등 상용 | 정밀 개별시세 | 라이선스·유료. 서비스 확장 시 |

> ⚠️ 각 공공 API의 정확한 엔드포인트/파라미터/한도는 구현 시점에 data.go.kr에서
> 활용신청 후 Swagger 명세로 확인할 것. 신청 후 반영까지 최대 1영업일 소요될 수 있음.
> 단독주택/토지/오피스텔은 아파트와 별도 API/필드 구조일 수 있으니 물건종류별 확인.

---

## 2. 입력 플로우 (3-way)

**① 등기부등본 업로드 → Gemini 추출** (선택, MTS 모듈과 동일 기술)
- 추출 대상: 소유자·지분, 근저당권(채권최고액→주담대 잔액 추정), 전세권/임차권
- 주의: 채권최고액은 보통 대출원금의 110~130% → 실제 잔액은 별도 확인 필요(추정 플래그)

**② 주소·단지·면적 입력 → 실거래가 API 조회**
- 입력: 시도/시군구(법정동코드 앞 5자리), 단지명, 전용면적, 동/층(선택)
- 조회: 해당 지역 최근 N개월 거래 → 같은 단지·유사 면적으로 필터 → 시세 추정

**③ 수동 입력 보완** (자동으로 못 캐는 값)
- 취득일·취득가액(양도세 base), 용도(실거주/임대/투자), 보유형태(단독/공동/지분율)
- 임대현황(전세/월세 보증금·월세액), 물건종류(아파트/오피스텔/단독/토지/분양권)

---

## 3. 데이터 모델 (Supabase)

```sql
create table client_real_estate (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid references clients(id) not null,

  -- 물건 식별
  property_type   text not null,         -- apartment|officetel|house|land|presale_right(분양권)
  address         text,
  complex_name    text,                  -- 단지명
  area_m2         numeric,               -- 전용면적
  legal_dong_code text,                  -- 법정동코드 앞5자리

  -- 보유
  ownership_type  text not null,         -- sole(단독)|joint(공동)
  ownership_share numeric default 1.0,   -- 지분율(0~1)
  usage           text not null,         -- primary_residence(실거주)|rental|investment
  acquired_at     date,
  acquired_price  numeric,               -- 양도세 base

  -- 시세 (범위+출처)
  market_value      numeric,             -- 대표 추정시세
  market_value_low  numeric,
  market_value_high numeric,
  market_source     text,               -- molit_realtxn|public_price|kb|manual
  market_confidence text,               -- high|medium|low
  official_price    numeric,            -- 공시가격(세금 base)

  -- 임대 (보유형태에 따라 부호 의미 다름)
  lease_type        text,               -- none|jeonse|monthly
  deposit           numeric,            -- 전세/월세 보증금
  monthly_rent      numeric,

  source          text not null default 'manual',  -- manual|registry_ocr
  created_at      timestamptz default now()
);

-- 연결부채(주담대 등). 자산과 분리 테이블로 1:N 관리
create table client_real_estate_debt (
  id            uuid primary key default gen_random_uuid(),
  property_id   uuid references client_real_estate(id) on delete cascade not null,
  lender        text,
  balance       numeric not null,        -- 대출잔액
  interest_rate numeric,
  rate_type     text,                    -- fixed|variable
  maturity_date date,
  source        text default 'manual',   -- manual|registry_ocr_estimated
  confidence    text,
  created_at    timestamptz default now()
);
-- RLS: client_id 소유자만 접근
```

---

## 4. 실거래가 조회 + 매칭 로직 (스케치)

```ts
// lib/realestate/fetch-market-value.ts
// ⚠️ 엔드포인트/파라미터는 data.go.kr 활용신청 후 실제 명세로 교체
export async function estimateMarketValue(input: {
  legalDongCode: string;   // 앞5자리
  complexName: string;
  areaM2: number;
  monthsBack?: number;     // 기본 6
}) {
  const months = lastNMonths(input.monthsBack ?? 6); // ["202601","202602",...]
  const txns: Txn[] = [];

  for (const ym of months) {
    const rows = await fetchMolitTxns(input.legalDongCode, ym); // 지역+월 단위 조회
    txns.push(...rows);
  }

  // 같은 단지 + 유사 전용면적(±3%)으로 필터
  const matched = txns.filter(
    (t) =>
      normalize(t.complexName) === normalize(input.complexName) &&
      Math.abs(t.areaM2 - input.areaM2) / input.areaM2 <= 0.03
  );

  if (matched.length === 0) {
    return { value: null, confidence: "low", source: "molit_realtxn",
             note: "최근 동일단지/면적 거래 없음 → 공시가격 또는 수동입력 필요" };
  }

  const prices = matched.map((m) => m.price).sort((a, b) => a - b);
  return {
    value: median(prices),
    low: prices[0],
    high: prices[prices.length - 1],
    // 거래 건수 많고 최근일수록 신뢰도 상승
    confidence: matched.length >= 3 ? "high" : "medium",
    source: "molit_realtxn",
    sampleSize: matched.length,
  };
}
```

---

## 5. 파생 지표 계산 (RRTTLLU로 넘길 값)

```ts
// lib/realestate/derive.ts
export function deriveMetrics(p: Property, debts: Debt[]) {
  const myValue = (p.market_value ?? 0) * p.ownership_share; // 지분 반영
  const totalDebt = debts.reduce((s, d) => s + d.balance, 0);

  // 전세보증금 부호: 임대인이면 부채(반환의무)
  const depositLiability =
    p.usage === "rental" && p.lease_type === "jeonse" ? (p.deposit ?? 0) : 0;

  const equity = myValue - totalDebt - depositLiability;   // 순자산 기여분

  // 실거주 주택은 투자가능자산에서 제외
  const investableEquity = p.usage === "primary_residence" ? 0 : equity;

  const ltv = myValue > 0 ? (totalDebt + depositLiability) / myValue : null;

  // 임대수익률(월세 기준, 연환산) — 전세는 별도 처리
  const rentalYield =
    p.lease_type === "monthly" && p.monthly_rent && myValue > 0
      ? (p.monthly_rent * 12) / (myValue - (p.deposit ?? 0))
      : null;

  return { myValue, totalDebt, equity, investableEquity, ltv, rentalYield };
}
```

**RRTTLLU 연결 포인트**
- 순자산(net worth) = Σ equity (전 부동산) + 금융자산
- 투자가능자산(investable) = Σ investableEquity (실거주 제외) + 금융자산
- **L(유동성) 점수: 부동산은 강하게 감점** (즉시 현금화 불가). 실거주는 더 감점.
- LTV/총부채는 Risk capacity 평가에 반영.

---

## 6. 엣지 케이스 체크리스트

- [ ] 같은 단지 최근 거래 없음 → value null, 공시가격 또는 수동입력으로 폴백
- [ ] 공동명의/지분 → ownership_share로 전 지표 안분
- [ ] 실거주 1주택 → investable 제외, L 점수 추가 감점
- [ ] 전세 임대인 → 보증금 부채 처리 / 임차인 → 보증금은 별도 '묶인 자산'
- [ ] 분양권·입주권 → 시세 추정 불가, 별도 자산군으로 분리(납입금 기준)
- [ ] 단독주택/토지 → 실거래가 매칭 어려움 → 공시가격+수동 비중↑
- [ ] 채권최고액 ≠ 대출잔액 → 등기부 추출값은 'estimated' 플래그, 실잔액 확인 권장
- [ ] 다주택자 → 종부세 합산 별도 고려(세금 모듈과 연계)

---

## 7. 구현 우선순위

1. 수동입력 + 데이터 모델 + 파생지표 계산 (MVP, API 없이도 동작)
2. 국토부 실거래가 API 연동 + 단지/면적 매칭
3. 공시가격 연동(세금 base)
4. 등기부등본 Gemini 추출(소유권·근저당)
5. 한국부동산원 지역 동향 위젯(부가)
6. (확장) KB시세 등 상용 정밀시세 라이선스 검토

---

## 8. 참고: 정확도 한계 명시 (UI에 표기 권장)

자동 추정시세는 "같은 단지 최근 실거래 기반 추정"이며 호가·현재가와 다를 수 있음.
PB 상담 시 참고치로 쓰고, 중요한 의사결정 전엔 감정평가/KB시세로 보정 권장.
