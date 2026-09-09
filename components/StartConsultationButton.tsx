"use client";

// Book 표 행에서 바로 상담을 시작하는 버튼.
//
// BookDashboard 에서 분리한 이유: 그 파일은 팀원이 최근 재설계한 곳이라(2026-09-07
// "redesign PB home client book", 09-08 수정) 상담 상태·모달을 그 안에 넣으면 충돌면적이
// 커진다. 여기로 빼고 저쪽에는 <td> 한 줄만 둔다.
//
// ⚠️ 행 전체에 goClient(고객 상세로 이동) onClick 이 걸려 있다. stopPropagation 을 하지
//    않으면 상담 시작을 눌러도 화면이 고객 상세로 넘어가 버린다. 모달을 감싸는 래퍼에도
//    걸어 둔다 — 모달이 이 <td> 안에서 렌더되므로 모달 내부 클릭도 행까지 버블링된다.

import { useState } from "react";
import type { Client } from "@/lib/types";
import ConsultationModal from "./ConsultationModal";

interface Props {
  client: Client | null;
  pbId: string;
  /** 저장 후 상위 목록·이력 새로고침. 승인 해제도 여기서 함께 처리한다. */
  onSaved: () => void;
}

export default function StartConsultationButton({ client, pbId, onSaved }: Props) {
  const [open, setOpen] = useState(false);

  // rows 에는 있는데 clients 목록에서 못 찾은 경우(삭제 직후 등). 버튼을 숨기지 않고
  // 비활성으로 남긴다 — 열이 비면 표 정렬이 흐트러지고 왜 없는지도 알 수 없다.
  if (!client) {
    return (
      <span className="text-[11px] text-fg-muted" title="고객 정보를 불러오지 못했습니다">
        —
      </span>
    );
  }

  return (
    <span onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        className="whitespace-nowrap rounded-md border border-[#1769D2] px-2 py-0.5 text-[11px] font-bold text-[#0D57BA] transition-colors hover:bg-[#1769D2]/10"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
      >
        상담 시작
      </button>
      <ConsultationModal
        open={open}
        client={client}
        pbId={pbId}
        onClose={() => setOpen(false)}
        onSaved={onSaved}
      />
    </span>
  );
}
