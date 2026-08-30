"use client";

// 7요인 화면 상단 헤리티지 신호 배지.
// 판정 로직은 lib/heritage/ 를 그대로 호출만 한다(그쪽 파일은 수정하지 않는다).
// 세액 구간·납부재원 갭·전문가 핸드오프는 여기서 다루지 않는다 — 신호 노출만.
// hasNeed=false 또는 조회 실패 시 아무것도 렌더하지 않아 7요인 화면을 막지 않는다.

import { useEffect, useState } from "react";
import type { Client } from "@/lib/types";
import {
  listOwnershipRelationshipsBulk,
  listFamilyRelationshipsBulk,
  listRealEstateWithDebtBulk,
  listGiftEventsBulk,
} from "@/lib/store";
import { resolveHeritageInputsBulk, assessHeritage, flagBusinessSuccessionReview } from "@/lib/heritage";
import type { HeritageAssessment, HeritageUrgencyLevel, BusinessSuccessionFlag } from "@/lib/heritage";

interface Props {
  client: Client;
  allClients: Client[];
}

const URGENCY_BADGE_CLASS: Record<HeritageUrgencyLevel, string> = {
  "즉시": "badge-danger",
  "3개월 내": "badge-warning",
  "6개월 내": "badge-warning",
  "1년 내": "badge-success",
  "해당없음": "badge-muted",
};

export default function HeritageSignalBadge({ client, allClients }: Props) {
  const [assessment, setAssessment] = useState<HeritageAssessment | null>(null);
  const [successionFlag, setSuccessionFlag] = useState<BusinessSuccessionFlag | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (client.clientType !== "individual") {
        setAssessment(null);
        return;
      }
      try {
        // HeritagePanel이 쓰던 것과 동일한 벌크 쿼리 4종 — 새 쿼리를 추가하지 않는다.
        const [ownershipRelationships, familyRelationships, realEstate, giftEvents] = await Promise.all([
          listOwnershipRelationshipsBulk([client.id]),
          listFamilyRelationshipsBulk([client.id]),
          listRealEstateWithDebtBulk([client.id]),
          listGiftEventsBulk([client.id]),
        ]);
        if (cancelled) return;

        const { heritageInputs, successionSignals } = resolveHeritageInputsBulk({
          allClients,
          targetClientIds: [client.id],
          ownershipRelationships,
          familyRelationships,
          realEstate,
          giftEvents,
          asOf: new Date(),
        });

        const input = heritageInputs.get(client.id);
        if (!input) {
          setAssessment(null);
          return;
        }
        const signal = successionSignals.get(client.id);
        setAssessment(assessHeritage(input));
        setSuccessionFlag(signal ? flagBusinessSuccessionReview(signal) : null);
      } catch {
        // 조회 실패는 배지를 숨기는 것으로 처리 — 7요인 화면 자체는 계속 보여야 한다.
        if (!cancelled) setAssessment(null);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [client.id, client.clientType, allClients]);

  // hasNeed=false면 아무것도 렌더하지 않는다.
  if (!assessment?.demand.hasNeed) return null;

  const { urgency, dataAssumptionsUsed } = assessment;

  return (
    <div className="mb-3 rounded-xl border border-border bg-surface-2 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="badge-navy">헤리티지 상품 검토 필요</span>
        {urgency.level !== "해당없음" && (
          <span className={URGENCY_BADGE_CLASS[urgency.level]}>{urgency.level}</span>
        )}
      </div>
      {successionFlag?.flagged && (
        <p className="mt-2 text-xs font-semibold text-[#1428A0]">{successionFlag.reason}</p>
      )}
      {dataAssumptionsUsed && (
        <p className="mt-1.5 text-[11px] text-fg-muted">
          가족 정보 미입력 — 추정치입니다. 기본 정보 → 관계 네트워크에서 가족관계를 입력하면 더 정확해집니다.
        </p>
      )}
    </div>
  );
}
