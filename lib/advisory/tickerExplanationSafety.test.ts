import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateTickerExplanation } from "./tickerExplanationSafety";

describe("ticker AI explanation safety", () => {
  const facts = "52주 상태, 20일 수익률 -3.2%, 거래량 1.8배, 기준일 2026-08-21";

  it("FACTS에 있는 숫자만 쉬운 말로 반복할 수 있다", () => {
    assert.equal(validateTickerExplanation("20일 수익률은 -3.2%이고 거래량은 1.8배입니다.", facts).passed, true);
  });

  it("새 숫자 또는 권유성 문구가 나오면 템플릿으로 대체하도록 차단한다", () => {
    assert.equal(validateTickerExplanation("향후 15% 오를 수 있습니다.", facts).passed, false);
    assert.equal(validateTickerExplanation("강한 매수 구간입니다.", facts).passed, false);
    assert.equal(validateTickerExplanation("비중 확대가 적절합니다.", facts).passed, false);
  });
});
