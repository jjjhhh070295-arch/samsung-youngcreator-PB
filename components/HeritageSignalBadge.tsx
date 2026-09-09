"use client";

// 7요인 화면의 헤리티지 신호 배지.
//
// ── 판정 기준 (2026-09-09 단순화) ───────────────────────────────────────────
//   개인 고객 AND 만 55세 이상 AND AUM 100억 이상  →  "헤리티지 상품 검토 필요"
//   그 외에는 아무것도 그리지 않는다.
//
// 100억은 AUM(parties.asset_size) 기준이다. 과세초과액이 아니다 — 공제 추정을 거치지
// 않으므로 가족관계 정보 유무에 결과가 흔들리지 않는다.
//
// 긴급도 라벨(즉시 / 3개월 내 / 6개월 내 / 1년 내)은 없앴다. 이 배지는 "검토해 볼 만한
// 고객인가"만 알리고, 얼마나 급한지는 헤리티지 화면에서 판단한다.
//
// ── lib/heritage/ 의 점수 계산을 고치지 않은 이유 ───────────────────────────
// assessHeritage 와 그 임계값(HERITAGE_DEMAND.needThresholdScore, HERITAGE_URGENCY)은
// 이 배지 말고도 네 곳이 쓴다 — app/pb/[pbId]/page.tsx(고객 목록), HeritagePanel,
// HeritageHandoffBlock(세무사 인계), lib/advisory/book.ts(URGENCY_RANK 로 우선순위 정렬).
// 거기서 임계값을 바꾸면 배지와 무관한 화면들의 판정과 정렬이 함께 달라진다. 그래서
// 판정 로직은 그대로 두고 이 배지에서만 새 기준으로 거른다.
//
// 그 결과 이 컴포넌트는 DB 를 전혀 읽지 않는다. 예전에는 벌크 쿼리 4종(지분관계·가족관계·
// 부동산·증여이력)을 돌려 점수를 냈는데, 새 기준은 Client 객체에 이미 있는 값만 쓴다.
//
// 함께 사라진 것: 사업승계 검토 문구(flagBusinessSuccessionReview)와 "가족 정보 미입력 —
// 추정치입니다" 안내. 전자는 별개 신호이고 후자는 추정을 하지 않게 되어 뜻이 없어졌다.
// 사업승계 신호가 다시 필요하면 헤리티지 화면 쪽에 두는 편이 개념상 맞다.

import type { Client } from "@/lib/types";
import { calcAgeAt } from "@/lib/heritage/demand";

/** 배지가 뜨는 최소 나이(만). */
export const HERITAGE_SIGNAL_MIN_AGE = 55;

/** 배지가 뜨는 최소 AUM(원). assetSize 그대로 비교한다. */
export const HERITAGE_SIGNAL_MIN_AUM_WON = 10_000_000_000;

/**
 * 배지 표시 여부. 순수 함수라 화면 없이 검증할 수 있다.
 *
 * 생년월일이 없거나 파싱되지 않으면 표시하지 않는다 — 나이를 모르면 55세 이상이라고
 * 단정할 수 없다. 자산만 크다고 띄우면 근거 없는 신호가 된다.
 */
export function shouldShowHeritageSignal(
  client: Pick<Client, "clientType" | "birthDate" | "assetSize">,
  asOf: Date = new Date(),
): boolean {
  if (client.clientType !== "individual") return false;
  if ((client.assetSize ?? 0) < HERITAGE_SIGNAL_MIN_AUM_WON) return false;
  if (!client.birthDate) return false;
  const age = calcAgeAt(client.birthDate, asOf);
  if (age == null) return false;
  return age >= HERITAGE_SIGNAL_MIN_AGE;
}

interface Props {
  client: Client;
}

export default function HeritageSignalBadge({ client }: Props) {
  // 조건에 맞지 않으면 아무것도 그리지 않는다. 호출부가 배지 줄 안에 두므로 null 이면
  // 그 자리가 사라질 뿐 줄 자체가 무너지지 않는다(빈 자리 표시자를 두지 않는 이유).
  if (!shouldShowHeritageSignal(client)) return null;

  // 카드가 아니라 배지 하나만 낸다.
  //
  // 예전에는 7요인 섹션 최상단에 별도 카드로 떠 있었다. 제목 바로 아래라 7요인 판정
  // 결과처럼 읽혔는데, 헤리티지는 나이·AUM 으로 판정하는 별개 신호다. "최종 투자성향"
  // 카드의 "7요인 분석" 배지 옆으로 옮기면서 카드 껍데기를 벗겨 같은 줄에 앉힌다.
  //
  // badge-navy 를 쓰지 않는 이유: 바로 옆 "7요인 분석"이 navy 라 색이 같으면 한 덩어리로
  // 읽힌다. 별개 신호라는 것이 색으로도 드러나야 한다.
  return <span className="badge-warning whitespace-nowrap">헤리티지 상품 검토 필요</span>;
}
