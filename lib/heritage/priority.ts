// 헤리티지 상담 우선순위 정렬 — BookDashboard "우선 확인 고객" 등에 이 랭킹을 쓸 예정
// (아직 연결하지 않음). 2단계 정렬: 1순위 긴급도, 2순위 score.
//
// 왜 긴급도가 1순위인가: score는 "상담이 필요한 정도"(자산 규모·부동산 비중·증여이력 등)를
// 나타내고, 긴급도는 "언제까지 미룰 수 있는지"(주로 나이·10년 룰 남은 시간)를 나타낸다.
// 자산이 조금 더 큰 젊은 고객보다, 시간이 정말 없는 고령 고객이 먼저 상담돼야 한다 —
// score만으로 정렬하면 45세와 78세가 같은 자산이면 동순위로 묶여 고령 고객이 뒤로 밀린다.
// score는 같은 긴급도 안에서 "그중 누가 더 급한가"를 가르는 2차 기준으로만 쓴다.

import type { HeritageUrgencyLevel } from "./types";

export const URGENCY_RANK: Record<HeritageUrgencyLevel, number> = {
  "즉시": 4,
  "3개월 내": 3,
  "6개월 내": 2,
  "1년 내": 1,
  "해당없음": 0,
};

export interface HeritagePriorityInput {
  urgencyLevel: HeritageUrgencyLevel;
  score: number;
}

/** Array.prototype.sort용 비교자 — 내림차순(급한/점수 높은 순)으로 정렬된다. */
export function compareHeritagePriority(a: HeritagePriorityInput, b: HeritagePriorityInput): number {
  const rankDiff = URGENCY_RANK[b.urgencyLevel] - URGENCY_RANK[a.urgencyLevel];
  if (rankDiff !== 0) return rankDiff;
  return b.score - a.score;
}
