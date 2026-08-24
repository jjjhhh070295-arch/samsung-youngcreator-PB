export const EXTRACTION_PROMPT = `당신은 한국 증권사 MTS(키움 영웅문, 삼성 mPOP, 미래에셋,
NH나무, 토스증권, 카카오페이증권 등)의 '보유종목/잔고/자산현황' 캡쳐를 판독하는 추출기다.

[작업]
- 화면에 보이는 보유 종목을 한 행씩 추출한다.
- 국내주식과 해외주식을 구분한다.
- 여러 장의 이미지가 주어지면 종목명 기준으로 중복을 제거하고 병합한다.

[추출 대상 — 정적 정보만]
- name: 종목명 (필수)
- ticker: 종목코드. 국내 6자리 숫자만, 불확실하면 null.
- market: KOSPI | KOSDAQ | NASDAQ | NYSE | 기타. 불확실하면 null.
- currency: KRW | USD (필수)
- quantity: 보유수량 (필수, 양수)
- avg_price: 매입단가/평균단가. 1주당 매입가격, 반드시 양수.
- current_price: 현재가. 교차검증 전용(저장 안 함). 반드시 양수. 화면에 없으면 null.

[필드 구분 — 반드시 지킬 것]
- avg_price(매입단가)와 current_price(현재가)를 혼동하지 말 것.
- current_price는 현재 시장 1주당 가격. 평가손익·수익률과 혼동 금지.
- 평가금액/평가손익/수익률은 추출하지 않는다.

[MTS별 레이아웃 주의]
▶ 키움 영웅문 — 종목당 2줄 구조:
  1행: 종목명 | 매입가(=avg_price) | 보유수량(=quantity) | 평가손익(무시)
  2행:         | 현재가(=current_price, 파란색/분홍색 숫자) | 가능수량(무시) | 수익률(무시)
  → 2행의 파란색/분홍색 숫자가 current_price다. 반드시 읽어라.

[엄격 규칙]
1. 화면에서 확인되지 않는 값은 추측하지 말고 null로 둔다.
2. 숫자가 흐릿하거나 가려져 불확실하면 해당 행 confidence를 "low"로 한다.
3. 콤마/원화기호/% 기호를 제거한 순수 숫자로 변환한다 ("1,234,000원" -> 1234000).
4. 국내 종목코드는 6자리 숫자일 때만 ticker에 넣는다.

[한국 종목 표기 주의]
- 우선주: "삼성전자우", "현대차2우B" 등 접미사를 그대로 보존한다.
- ETF: "KODEX 200", "TIGER 미국나스닥100" 등 잘림 없이 전체 이름을 보존한다.
- 해외주식: currency=USD, market=NASDAQ/NYSE 등.`;

export const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    broker: { type: "string", nullable: true },
    holdings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name:          { type: "string" },
          ticker:        { type: "string", nullable: true },
          market:        { type: "string", nullable: true },
          currency:      { type: "string" },
          quantity:      { type: "number" },
          avg_price:     { type: "number", nullable: true },
          current_price: { type: "number", nullable: true }, // 교차검증용, 저장 안 함
          confidence:    { type: "string", enum: ["high", "medium", "low"] },
          notes:         { type: "string", nullable: true },
        },
        required: ["name", "quantity", "currency", "confidence"],
      },
    },
    warnings: { type: "array", items: { type: "string" } },
  },
  required: ["holdings"],
};
