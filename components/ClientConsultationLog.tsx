"use client";

// PB Home 하단 — 고객 선택(좌) + 선택 고객의 상담 이력(우).
//
// PB Home(app/pb/[pbId]/page.tsx)에서 분리한 이유는 그 파일이 팀원 접촉이 잦아서다.
// 저쪽에는 이 컴포넌트 한 줄만 둔다.
//
// ── 0건이 기본 화면이다 ────────────────────────────────────────────────────
// 담당 고객 대부분이 상담 0건인 상태로 운영된다. 그래서 "이력이 있을 때만 보여주는"
// 설계를 쓰지 않는다 — 고객 상세는 consultations.length > 0 일 때만 섹션을 렌더해서
// 0건이면 기능이 아예 없는 것처럼 보였고, 이 화면을 만들게 된 계기가 그것이다.
// 여기서는 섹션과 헤더(제목·고객명·건수)를 항상 그리고, 비었을 때 다음 행동(상담 시작)을
// 같은 자리에서 제시한다.
//
// ── ConsultationHistory 는 건드리지 않는다 ─────────────────────────────────
// 그 컴포넌트는 0건일 때 자체 EmptyView 를 반환하는데 거기엔 "상담 시작" 버튼이 없다.
// 고객 상세에서도 쓰이므로 고치면 그쪽 화면까지 바뀐다. 그래서 0건 분기는 여기서 처리하고
// 1건 이상일 때만 위임한다.

import { useEffect, useMemo, useState } from "react";
import type { Client, Consultation } from "@/lib/types";
import { isIpsWorkflowApproved } from "@/lib/advisory/workflowApprovals";
import ClientAvatar from "@/components/ClientAvatar";
import ConsultationHistory from "@/components/ConsultationHistory";
import StartConsultationButton from "@/components/StartConsultationButton";

interface Props {
  pbId: string;
  /** 담당 고객만. 코드순으로 들어온다고 가정하지 않고 여기서 정렬한다. */
  clients: Client[];
  /** 담당 고객들의 상담 전부. 선택 고객으로 여기서 거른다. */
  consultations: Consultation[];
  /** 상담 저장 후 상위 재조회 + 승인 해제. */
  onConsultationSaved: (clientId: string) => void;
}

export default function ClientConsultationLog({
  pbId,
  clients,
  consultations,
  onConsultationSaved,
}: Props) {
  const sorted = useMemo(
    () => clients.slice().sort((a, b) => a.code.localeCompare(b.code)),
    [clients],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // 진입 시 첫 고객(코드순)을 자동 선택한다. 담당 고객이 2명 수준이라 "아직 안 고름"
  // 상태를 따로 두면 빈 화면이 한 단계 늘 뿐이다. 선택한 고객이 목록에서 사라지면
  // (삭제·담당 변경) 다시 첫 고객으로 되돌린다.
  useEffect(() => {
    if (sorted.length === 0) {
      if (selectedId !== null) setSelectedId(null);
      return;
    }
    if (!selectedId || !sorted.some((c) => c.id === selectedId)) {
      setSelectedId(sorted[0].id);
    }
  }, [sorted, selectedId]);

  const selected = sorted.find((c) => c.id === selectedId) ?? null;
  const mine = useMemo(
    () => (selected ? consultations.filter((c) => c.clientId === selected.id) : []),
    [consultations, selected],
  );

  const typeCount = (t: Client["clientType"]) => sorted.filter((c) => c.clientType === t).length;

  return (
    <div className="grid border border-border bg-white md:grid-cols-2">
      {/* ── 좌: 고객 구성 + 선택 ── */}
      <section className="relative border-b border-border p-4 md:border-b-0 md:border-r">
        <span className="absolute left-4 top-2 h-[3px] w-16 rounded bg-[#1769D2]" aria-hidden="true" />
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-[#1428A0]">
              Book Insight
            </p>
            <h2 className="mt-0.5 text-sm font-black text-fg">고객 구성</h2>
          </div>
          <span className="badge-muted">총 {sorted.length}명</span>
        </div>

        <div className="mt-3 flex h-1.5 overflow-hidden rounded-full bg-slate-100" aria-label="고객 유형 구성">
          {sorted.length > 0 && (
            <>
              <span className="bg-[#1769D2]" style={{ width: `${(typeCount("individual") / sorted.length) * 100}%` }} />
              <span className="bg-[#84B2EE]" style={{ width: `${(typeCount("corporate") / sorted.length) * 100}%` }} />
              <span className="bg-slate-400" style={{ width: `${(typeCount("sole_proprietor") / sorted.length) * 100}%` }} />
            </>
          )}
        </div>
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-xs text-slate-600">
          <span><i className="mr-1.5 inline-block h-2 w-2 rounded-full bg-[#1428A0]" />개인 {typeCount("individual")}명</span>
          <span><i className="mr-1.5 inline-block h-2 w-2 rounded-full bg-[#2563EB]" />법인 {typeCount("corporate")}명</span>
          <span><i className="mr-1.5 inline-block h-2 w-2 rounded-full bg-slate-400" />개인사업자 {typeCount("sole_proprietor")}명</span>
        </div>

        {sorted.length === 0 ? (
          <p className="mt-4 rounded-lg bg-slate-50 px-3 py-4 text-xs text-fg-muted">
            담당 고객이 없습니다.
          </p>
        ) : (
          <ul className="mt-4 space-y-1 border-t border-border/60 pt-3">
            {sorted.map((c) => {
              const count = consultations.filter((x) => x.clientId === c.id).length;
              const on = c.id === selectedId;
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={() => setSelectedId(c.id)}
                    className={`flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left transition-colors ${
                      on ? "bg-[#EAF2FF] ring-1 ring-[#1769D2]/40" : "hover:bg-surface-2"
                    }`}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <ClientAvatar name={c.name} type={c.clientType} size="sm" />
                      <span className="min-w-0">
                        <span className="block truncate text-xs font-bold text-fg">{c.name}</span>
                        <span className="font-mono text-[10px] text-fg-muted">{c.code}</span>
                      </span>
                    </span>
                    <span className={`shrink-0 text-[10px] ${count > 0 ? "text-[#0D57BA]" : "text-fg-muted"}`}>
                      상담 {count}건
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ── 우: 선택 고객의 상담 이력 ── */}
      <section className="relative p-4">
        <span className="absolute left-4 top-2 h-1.5 w-1.5 rounded-full bg-[#1769D2]" aria-hidden="true" />
        {/* 헤더는 0건이어도 항상 그린다. 사라지면 기능이 없는 것으로 읽힌다. */}
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-fg">고객별 상담 이력</h2>
          <span className="text-[11px] text-fg-muted">
            {selected ? `${selected.name} · ${mine.length}건` : "고객 없음"}
          </span>
        </div>

        {!selected ? (
          <p className="mt-3 rounded-lg bg-slate-50 px-3 py-4 text-xs text-fg-muted">
            담당 고객이 없습니다.
          </p>
        ) : mine.length === 0 ? (
          <div className="mt-3 rounded-lg bg-slate-50 px-3 py-6 text-center">
            <p className="text-xs font-semibold text-fg">아직 상담 기록이 없습니다</p>
            <p className="mt-1 text-[11px] text-fg-muted">
              상담을 시작하면 이곳에 회차별로 쌓입니다.
            </p>
            <div className="mt-3 flex justify-center">
              <StartConsultationButton
                client={selected}
                pbId={pbId}
                onSaved={() => onConsultationSaved(selected.id)}
              />
            </div>
          </div>
        ) : (
          <>
            {/* 최신 확정 IPS 문서가 있는 상담이 있으면 안내만. 현재 7요인 요약으로 대체하지 않는다. */}
            <div className="mt-3 rounded-lg border border-border bg-surface-2 px-3 py-2">
              <p className="text-[10px] font-bold text-fg-muted">확정 IPS (상담 이력)</p>
              {(() => {
                const withDoc = mine
                  .slice()
                  .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
                  .find((c) => c.ipsDocumentSnapshot);
                if (withDoc?.ipsDocumentSnapshot) {
                  return (
                    <p className="mt-1 text-[11px] leading-relaxed text-fg">
                      최근 확정본:{" "}
                      {new Date(withDoc.ipsDocumentSnapshot.capturedAt).toLocaleString("ko-KR")} ·
                      상세 보기에서 A4 문서를 확인하세요.
                    </p>
                  );
                }
                if (isIpsWorkflowApproved(selected)) {
                  return (
                    <p className="mt-1 text-[11px] text-fg-muted">
                      IPS는 승인됐지만 이 고객의 상담 이력에 저장된 확정 문서가 없습니다. 상담 완료
                      시 PB 메모와 함께 저장됩니다.
                    </p>
                  );
                }
                return (
                  <p className="mt-1 text-[11px] text-fg-muted">
                    아직 저장된 확정 IPS 문서가 없습니다 — 아래는 각 상담 시점의 기록입니다.
                  </p>
                );
              })()}
            </div>
            <div className="mt-3">
              <ConsultationHistory
                consultations={mine}
                client={selected}
                onSaved={() => onConsultationSaved(selected.id)}
              />
            </div>
          </>
        )}
      </section>
    </div>
  );
}
