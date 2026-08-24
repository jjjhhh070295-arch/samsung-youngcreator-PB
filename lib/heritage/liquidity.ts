// 납부재원 갭 — 이 기능의 핵심 인사이트. 상속세는 현금으로 납부해야 하는데, 자산이 부동산에
// 묶여 있으면 세액 구간(estimateInheritanceTaxRange)만큼의 현금이 당장 없을 수 있다.
//
// 세액이 구간(하한~상한)이므로 갭도 구간으로 낸다. PB가 고객에게 쓸 한 줄 메시지는 "최악의
// 경우"(상한 세액 기준) 하나로 못박는다 — 상한 기준으로 부족하다고 말해놓고 실제로는 하한만
// 나오면 안전한 방향의 오차이지만, 반대로 하한 기준으로 안심시켰다가 상한이 나오면 PB의
// 신뢰가 깨진다. 갭이 없으면(재원이 충분하면) 그것도 있는 그대로 말한다 — 억지로 위기감을
// 만들지 않는다.

import { eok } from "./format";
import type { HeritageReason } from "./types";

export interface HeritagePaymentGapResult {
  /** 현금화 가능한 금융자산(client_holdings 평가액 합계 등) — 호출부가 이미 합산해 넘긴다. */
  liquidAssetsWon: number;
  minTaxWon: number;
  maxTaxWon: number;
  /** 하한 세액 기준 갭 = minTaxWon - liquidAssetsWon. 음수면 최선의 경우에도 재원이 남는다. */
  minGapWon: number;
  /** 상한 세액 기준 갭(최악의 경우) = maxTaxWon - liquidAssetsWon. PB 메시지는 이 값을 쓴다. */
  maxGapWon: number;
  /** true면 최악의 경우(상한 세액) 기준으로 재원이 부족하다. */
  hasGap: boolean;
  reasons: HeritageReason[];
}

export function computePaymentGap(input: {
  liquidAssetsWon: number;
  minTaxWon: number;
  maxTaxWon: number;
}): HeritagePaymentGapResult {
  const { liquidAssetsWon, minTaxWon, maxTaxWon } = input;
  const minGapWon = minTaxWon - liquidAssetsWon;
  const maxGapWon = maxTaxWon - liquidAssetsWon;
  const hasGap = maxGapWon > 0;

  const reasons: HeritageReason[] = [];
  if (hasGap) {
    reasons.push({
      code: "payment_gap",
      text:
        `예상 상속세 ${eok(maxTaxWon)}에 비해 현금성 자산이 ${eok(liquidAssetsWon)}으로 ` +
        `최대 ${eok(maxGapWon)}이 부족합니다. 부동산 매각 없이는 납부가 어려워 사전 준비가 필요합니다.`,
    });
  } else {
    reasons.push({
      code: "payment_gap_none",
      text: `현금성 자산 ${eok(liquidAssetsWon)}으로 예상 상속세 상한 ${eok(maxTaxWon)}을 충당할 수 있어, 별도의 납부재원 마련은 필요하지 않습니다.`,
    });
  }

  return { liquidAssetsWon, minTaxWon, maxTaxWon, minGapWon, maxGapWon, hasGap, reasons };
}
