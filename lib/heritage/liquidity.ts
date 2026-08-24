// 납부재원 갭 — 이 기능의 핵심 인사이트. 상속세는 현금으로 납부해야 하는데, 자산이 부동산에
// 묶여 있으면 세액 구간(estimateInheritanceTaxRange)만큼의 현금이 당장 없을 수 있다.
//
// 세액이 구간(하한~상한)이므로 갭도 구간으로 낸다. 세 가지 경우가 있다:
//   1) 상한 기준으로도 충분(maxGapWon<=0) — 항상 안전. 안심 문구.
//   2) 하한 기준으로도 부족(minGapWon>0) — 항상 부족. "최대 X억이 부족합니다"로 단정.
//   3) 하한은 충분한데 상한은 부족(minGapWon<=0<maxGapWon) — 배우자공제 적용 범위에 따라
//      갈리는 경계 케이스. 이걸 2)와 같은 단정 문구로 말하면 "하한만 나오면 실제로는
//      괜찮았는데 PB가 괜히 겁을 준 것"이 되므로, "충분할 수도/부족할 수도 있다"는
//      양쪽 가능성을 다 말하는 별도 문구를 쓴다.
// PB가 실제로 움직일지 말지 판단할 땐 항상 최악의 경우(상한 세액) 기준을 우선하되, 문구
// 톤은 위 세 경우로 나눠 확실성 정도를 정직하게 전달한다 — 억지로 위기감을 만들지 않는다.

import { eok } from "./format";
import type { HeritageReason } from "./types";

export type HeritagePaymentGapCertainty = "sufficient" | "uncertain" | "insufficient";

export interface HeritagePaymentGapResult {
  /** 현금화 가능한 금융자산(client_holdings 평가액 합계 등) — 호출부가 이미 합산해 넘긴다. */
  liquidAssetsWon: number;
  minTaxWon: number;
  maxTaxWon: number;
  /** 하한 세액 기준 갭 = minTaxWon - liquidAssetsWon. 음수면 최선의 경우에도 재원이 남는다. */
  minGapWon: number;
  /** 상한 세액 기준 갭(최악의 경우) = maxTaxWon - liquidAssetsWon. PB 메시지는 이 값을 쓴다. */
  maxGapWon: number;
  /** true면 최악의 경우(상한 세액) 기준으로 재원이 부족하다(certainty가 "sufficient"가 아님). */
  hasGap: boolean;
  /** sufficient=항상 충분, insufficient=항상 부족, uncertain=배우자공제 적용 범위에 따라 갈림. */
  certainty: HeritagePaymentGapCertainty;
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

  let certainty: HeritagePaymentGapCertainty;
  if (maxGapWon <= 0) certainty = "sufficient";
  else if (minGapWon > 0) certainty = "insufficient";
  else certainty = "uncertain";

  const hasGap = certainty !== "sufficient";
  const reasons: HeritageReason[] = [];

  if (certainty === "sufficient") {
    reasons.push({
      code: "payment_gap_none",
      text: `현금성 자산 ${eok(liquidAssetsWon)}으로 예상 상속세 상한 ${eok(maxTaxWon)}을 충당할 수 있어, 별도의 납부재원 마련은 필요하지 않습니다.`,
    });
  } else if (certainty === "insufficient") {
    reasons.push({
      code: "payment_gap",
      text:
        `예상 상속세 ${eok(maxTaxWon)}에 비해 현금성 자산이 ${eok(liquidAssetsWon)}으로 ` +
        `최대 ${eok(maxGapWon)}이 부족합니다. 부동산 매각 없이는 납부가 어려워 사전 준비가 필요합니다.`,
    });
  } else {
    reasons.push({
      code: "payment_gap_uncertain",
      text: `배우자공제 적용 범위에 따라 재원이 충분할 수도, 최대 ${eok(maxGapWon)}이 부족할 수도 있습니다.`,
    });
  }

  return { liquidAssetsWon, minTaxWon, maxTaxWon, minGapWon, maxGapWon, hasGap, certainty, reasons };
}
