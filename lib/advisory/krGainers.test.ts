import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseKisFluctuationRows } from "./krGainers";

describe("KIS fluctuation ranking fallback", () => {
  it("공식 등락률 순위 응답을 KOSPI 후보로 변환", () => {
    const rows = parseKisFluctuationRows(
      [
        {
          stck_shrn_iscd: "005930",
          hts_kor_isnm: "삼성전자",
          stck_prpr: "80000",
          prdy_ctrt: "+3.25",
          acml_vol: "1234567",
        },
      ],
      "KOSPI",
    );
    assert.deepEqual(rows, [
      {
        ticker: "005930",
        name: "삼성전자",
        price: 80000,
        changePct: 3.25,
        volume: 1234567,
        market: "KOSPI",
      },
    ]);
  });

  it("ETF와 가격이 없는 행은 제외", () => {
    const rows = parseKisFluctuationRows(
      [
        { stck_shrn_iscd: "123456", hts_kor_isnm: "테스트 ETF", stck_prpr: "10000" },
        { stck_shrn_iscd: "654321", hts_kor_isnm: "가격없음", stck_prpr: "0" },
      ],
      "KOSDAQ",
    );
    assert.equal(rows.length, 0);
  });
});
