"use client";

// "상담 시작" — 빈 상담 1건을 열고 기본정보 화면으로 보낸다.
//
// 예전에는 ConsultationModal 을 띄워 ① 전문 텍스트 입력 → 요인 분석 → 저장 순으로 갔다.
// 7요인 입력은 기본정보 화면에 이미 있어서 그 앞단이 중복이었고, 전문 텍스트도 더는 쓰지
// 않는다. 그래서 모달 없이 상담을 열고 곧바로 기본정보 화면으로 보낸다. notes 는 빈
// 문자열로 두고, PB 메모는 IPS 탭의 "상담 종료"에서 pb_memo 에 받는다.
//
// ── 진행 중 판별은 DB 에서 한다 ────────────────────────────────────────────
// ended_at 이 비어 있는 행이 곧 "진행 중"이다(findOpenConsultation). 진행 상태를
// localStorage 나 React state 에 들지 않는 이유는 그것들이 기기·새로고침을 넘지 못해서다 —
// 시작과 종료 사이에 화면이 바뀌는 흐름이라 그 방식이면 연결이 끊긴다.
//
// ── 이미 열린 상담이 있으면 새로 만들지 않는다 ─────────────────────────────
// 그 건을 이어간다. 빈 행이 쌓이는 것을 막고(이미 과거 15건 중 9건이 notes 가 비어 있다),
// 종료 시 "어느 건에 쓸지"가 모호해지는 것도 함께 없앤다.

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Client } from "@/lib/types";
import { createConsultation, findOpenConsultation } from "@/lib/store";

interface Props {
  client: Client | null;
  pbId: string;
  /** 상담 생성 후 상위 목록·이력 새로고침. */
  onStarted?: () => void;
  className?: string;
}

export default function StartConsultationButton({ client, pbId, onStarted, className }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  // rows 에는 있는데 clients 목록에서 못 찾은 경우(삭제 직후 등). 버튼을 숨기지 않고
  // 자리를 남긴다 — 열이 비면 표 정렬이 흐트러지고 왜 없는지도 알 수 없다.
  if (!client) {
    return (
      <span className="text-[11px] text-fg-muted" title="고객 정보를 불러오지 못했습니다">
        —
      </span>
    );
  }

  const start = async () => {
    setBusy(true);
    try {
      const open = await findOpenConsultation(client.id);
      if (!open) {
        await createConsultation({
          clientId: client.id,
          pbId,
          startedAt: new Date().toISOString(),
          // 빈 문자열을 넘기면 store 가 ended_at 을 null 로 넣는다 = 진행 중 표시.
          endedAt: "",
          durationSeconds: 0,
          // 전문 텍스트는 더 이상 받지 않는다. PB 메모는 종료 시 이 칸에 들어간다.
          notes: "",
          // 시작 시점 7요인. 종료 시 확정 IPS 로 덮어쓴다.
          ipsSnapshot: client.ips,
        });
      } else {
        alert("진행 중인 상담이 있습니다. 이어서 진행합니다.");
      }
      onStarted?.();
      router.push(`/pb/${pbId}/${client.id}?view=home`);
    } catch (e) {
      // 생성 실패를 조용히 넘기지 않는다 — 화면만 이동하면 상담이 열린 줄 알고 진행하다
      // 종료 시점에 대상 건이 없다.
      console.error("[상담 시작] 실패", e);
      alert("상담을 시작하지 못했습니다. 잠시 후 다시 시도하세요.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      disabled={busy}
      className={
        className ??
        "whitespace-nowrap rounded-md border border-[#1769D2] px-2 py-0.5 text-[11px] font-bold text-[#0D57BA] transition-colors hover:bg-[#1769D2]/10 disabled:opacity-40"
      }
      title="상담을 열고 기본정보 화면으로 이동합니다"
      onClick={(e) => {
        // Book 표는 행 전체에 goClient 가 걸려 있다. 막지 않으면 고객 상세로 튄다.
        e.stopPropagation();
        void start();
      }}
    >
      {busy ? "여는 중…" : "상담 시작"}
    </button>
  );
}
