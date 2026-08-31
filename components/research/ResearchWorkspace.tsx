"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Client } from "@/lib/types";
import { listClients } from "@/lib/store";
import { RESEARCH_COPILOT_AS_OF, RESEARCH_COPILOT_FIXTURE } from "@/lib/researchCopilot/fixture";
import {
  approveResearchDraft,
  appendOutputRecord,
  buildResearchDraft,
  canConsumeResearchDraft,
  claimIdsForSnapshot,
  compareViewSnapshots,
  createOutputRecord,
  findClaim,
  findSnapshot,
  validateClaimEvidence,
  validateSnapshots,
} from "@/lib/researchCopilot/logic";
import {
  isCurrentWorkspaceGeneration,
  normalizeWorkspaceClientId,
  parseResearchWorkspaceState,
  researchWorkspaceStorageKey,
} from "@/lib/researchCopilot/state";
import type {
  ResearchClaim,
  ResearchSourceDocument,
  ResearchViewSnapshot,
  ResearchWorkspaceState,
  ViewChange,
} from "@/lib/researchCopilot/types";

type WorkspaceView = "briefing" | "compare" | "client";

const TABS: Array<{ id: WorkspaceView; label: string; description: string }> = [
  { id: "briefing", label: "시장 브리핑", description: "당사 View와 전월 대비 변화" },
  { id: "compare", label: "View 비교·변화", description: "국내외 공개 View의 차이" },
  { id: "client", label: "고객 상담 브리프", description: "PB 검토·승인용 1페이지" },
];

const CURRENT_SNAPSHOT_IDS = [
  "snapshot-samsung-2026-08",
  "snapshot-kb-2026-08",
  "snapshot-korea-2026-08",
  "snapshot-jpm-2026-08",
];
const DRAFT_SNAPSHOT_IDS = ["snapshot-samsung-2026-07", ...CURRENT_SNAPSHOT_IDS];

const documentById = new Map(
  RESEARCH_COPILOT_FIXTURE.documents.map((document) => [document.sourceId, document]),
);

function buildAiExplanation(changes: ViewChange[]) {
  const stance = changes.find((item) => item.field === "stance");
  const risk = changes.find((item) => item.field === "risk-added");
  return [
    stance?.after ? `당사 핵심 View는 “${stance.after}”로 바뀌었습니다.` : "당사 핵심 View의 문구 변화는 확인되지 않았습니다.",
    risk?.after ? `새로 확인할 위험은 “${risk.after}”입니다.` : "새로 추가된 위험 문장은 없습니다.",
    "이는 검증된 문장을 쉬운 말로 재배열한 교육용 설명이며, 수치나 투자판단을 새로 만들지 않습니다.",
  ].join(" ");
}

function createInitialState(pbId: string, clientId: string): ResearchWorkspaceState {
  const previous = findSnapshot(RESEARCH_COPILOT_FIXTURE, "snapshot-samsung-2026-07");
  const current = findSnapshot(RESEARCH_COPILOT_FIXTURE, "snapshot-samsung-2026-08");
  const changes = previous && current
    ? compareViewSnapshots(RESEARCH_COPILOT_FIXTURE, previous, current, RESEARCH_COPILOT_AS_OF).changes
    : [];
  const aiEvidenceClaimIds = Array.from(new Set(changes.flatMap((item) => item.evidenceClaimIds)));
  if (aiEvidenceClaimIds.length === 0 && previous && current) {
    aiEvidenceClaimIds.push(previous.stanceClaimId, current.stanceClaimId);
  }
  const draft = buildResearchDraft({
    dataset: RESEARCH_COPILOT_FIXTURE,
    pbId,
    clientId,
    snapshotIds: DRAFT_SNAPSHOT_IDS,
    nowIso: RESEARCH_COPILOT_AS_OF,
    aiExplanation: buildAiExplanation(changes),
    aiEvidenceClaimIds,
  });
  return { version: 1, pbId, clientId, draft, outputs: [] };
}

function EvidenceButton({
  claimId,
  onOpen,
  label = "근거 보기",
}: {
  claimId: string;
  label?: string;
  onOpen: (claimId: string, trigger: HTMLButtonElement) => void;
}) {
  return (
    <button
      type="button"
      onClick={(event) => onOpen(claimId, event.currentTarget)}
      className="shrink-0 rounded-md border border-[#DCE4F5] bg-white px-2.5 py-1 text-[11px] font-bold text-[#1428A0] hover:border-[#2C3EE8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2C3EE8] focus-visible:ring-offset-2"
    >
      {label}
    </button>
  );
}

function ClaimLine({
  claimId,
  onOpen,
  label,
}: {
  claimId: string;
  onOpen: (claimId: string, trigger: HTMLButtonElement) => void;
  label?: string;
}) {
  const claim = findClaim(RESEARCH_COPILOT_FIXTURE, claimId);
  const issues = validateClaimEvidence(RESEARCH_COPILOT_FIXTURE, claimId, new Date().toISOString());
  if (!claim || issues.length > 0) {
    return <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-700">근거 누락·만료·충돌 · 정상 표시 및 출력 차단</p>;
  }
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-[#DCE4F5] bg-white p-3">
      <div className="min-w-0">
        {label && <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-[#64748B]">{label}</p>}
        <p className="text-sm leading-relaxed text-[#0F172A]">{claim.statement}</p>
      </div>
      <EvidenceButton claimId={claimId} onOpen={onOpen} />
    </div>
  );
}

function SnapshotCard({
  snapshot,
  onOpen,
}: {
  snapshot: ResearchViewSnapshot;
  onOpen: (claimId: string, trigger: HTMLButtonElement) => void;
}) {
  const source = documentById.get(snapshot.sourceId);
  const badge = source?.institutionKind === "samsung" ? "당사" : source?.institutionKind === "global" ? "외사" : "국내 경쟁사";
  return (
    <article className="rounded-2xl border border-[#DCE4F5] bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-base font-black text-[#0F172A]">{snapshot.institution}</h3>
            <span className="rounded-full bg-[#F0F3FA] px-2 py-0.5 text-[10px] font-bold text-[#64748B]">{badge}</span>
          </div>
          <p className="mt-1 text-[11px] text-[#64748B]">
            발행 {source?.publishedAt ?? "확인 필요"} · 기준 {source?.asOfDate ?? "확인 필요"} · 월간
          </p>
        </div>
        <span className="rounded-full border border-[#DCE4F5] bg-[#F5F7FC] px-2 py-1 text-[10px] font-bold text-[#1428A0]">
          교육용 데모
        </span>
      </div>
      <div className="mt-4 space-y-2">
        <ClaimLine claimId={snapshot.stanceClaimId} label="기관 View" onOpen={onOpen} />
        {snapshot.driverClaimIds.map((claimId) => (
          <ClaimLine key={claimId} claimId={claimId} label="핵심 전제" onOpen={onOpen} />
        ))}
        {snapshot.riskClaimIds.map((claimId) => (
          <ClaimLine key={claimId} claimId={claimId} label="주요 위험" onOpen={onOpen} />
        ))}
      </div>
    </article>
  );
}

function EvidenceDialog({
  claim,
  source,
  onClose,
}: {
  claim: ResearchClaim | null;
  source: ResearchSourceDocument | null;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!claim) return;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          "button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])",
        ) ?? [],
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [claim, onClose]);

  if (!claim) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" role="presentation">
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="research-evidence-title"
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-[#DCE4F5] bg-white p-5 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-bold text-[#2C3EE8]">Evidence · {claim.claimId}</p>
            <h2 id="research-evidence-title" className="mt-1 text-lg font-black text-[#0F172A]">
              원문 근거 확인
            </h2>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="근거 상세 닫기"
            className="min-h-10 rounded-lg border border-[#DCE4F5] px-3 text-sm font-bold text-[#0F172A] hover:bg-[#F0F3FA] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2C3EE8]"
          >
            닫기
          </button>
        </div>
        <div className="mt-5 rounded-xl bg-[#F5F7FC] p-4">
          <p className="text-sm leading-7 text-[#0F172A]">{claim.statement}</p>
        </div>
        <dl className="mt-5 grid grid-cols-[110px_1fr] gap-x-3 gap-y-3 text-xs">
          <dt className="font-bold text-[#64748B]">sourceId</dt><dd className="break-all text-[#0F172A]">{source?.sourceId ?? "누락"}</dd>
          <dt className="font-bold text-[#64748B]">기관</dt><dd className="text-[#0F172A]">{source?.institution ?? "누락"}</dd>
          <dt className="font-bold text-[#64748B]">문서 제목</dt><dd className="text-[#0F172A]">{source?.title ?? "누락"}</dd>
          <dt className="font-bold text-[#64748B]">발행일</dt><dd className="text-[#0F172A]">{source?.publishedAt ?? "누락"}</dd>
          <dt className="font-bold text-[#64748B]">기준일</dt><dd className="text-[#0F172A]">{source?.asOfDate ?? "누락"}</dd>
          <dt className="font-bold text-[#64748B]">페이지·섹션</dt><dd className="text-[#0F172A]">{claim.locator || "누락"}</dd>
          <dt className="font-bold text-[#64748B]">검토 상태</dt><dd className="font-bold text-[#166534]">{claim.reviewStatus}</dd>
          <dt className="font-bold text-[#64748B]">이용 범위</dt><dd className="text-[#0F172A]">{source?.rightsStatus ?? "확인 필요"}</dd>
        </dl>
        {source?.originalUrl && (
          <a
            href={source.originalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-5 inline-flex min-h-10 items-center rounded-lg bg-[#1428A0] px-4 text-sm font-bold text-white hover:bg-[#2C3EE8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2C3EE8] focus-visible:ring-offset-2"
          >
            공식 자료 경로 열기 ↗
          </a>
        )}
        <p className="mt-3 text-[11px] leading-relaxed text-[#64748B]">
          이 MVP의 문장은 교육용 가상 문장입니다. 링크는 향후 공식 원문 수집 경로를 설명하기 위한 것이며 실제 기관 View를 인용한 것이 아닙니다.
        </p>
      </section>
    </div>
  );
}

export default function ResearchWorkspace({ pbId, initialClientId }: { pbId: string; initialClientId?: string }) {
  const router = useRouter();
  const initialIdentity = normalizeWorkspaceClientId(initialClientId);
  const [view, setView] = useState<WorkspaceView>("briefing");
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedClientId, setSelectedClientId] = useState(initialIdentity);
  const [workspace, setWorkspace] = useState<ResearchWorkspaceState>(() => createInitialState(pbId, initialIdentity));
  const [evidenceChecked, setEvidenceChecked] = useState(false);
  const [message, setMessage] = useState("");
  const [activeClaimId, setActiveClaimId] = useState<string | null>(null);
  const lastEvidenceTrigger = useRef<HTMLButtonElement | null>(null);
  const generationRef = useRef(0);

  const identity = `${pbId}:${selectedClientId}`;
  const selectedClient = clients.find((client) => client.id === selectedClientId) ?? null;
  const authorizedClientIds = clients.map((client) => client.id);

  useEffect(() => {
    const nextClientId = normalizeWorkspaceClientId(initialClientId);
    if (nextClientId !== selectedClientId) setSelectedClientId(nextClientId);
  }, [initialClientId, selectedClientId]);

  useEffect(() => {
    const generation = ++generationRef.current;
    const expectedIdentity = identity;
    listClients()
      .then((items) => {
        if (!isCurrentWorkspaceGeneration(generation, generationRef.current, expectedIdentity, `${pbId}:${selectedClientId}`)) return;
        setClients(items.filter((client) => client.assignedPbId === pbId));
      })
      .catch(() => {
        if (isCurrentWorkspaceGeneration(generation, generationRef.current, expectedIdentity, `${pbId}:${selectedClientId}`)) {
          setClients([]);
        }
      });
  }, [identity, pbId, selectedClientId]);

  useEffect(() => {
    const expected = { pbId, clientId: selectedClientId };
    let next = createInitialState(pbId, selectedClientId);
    if (typeof window !== "undefined") {
      const raw = window.sessionStorage.getItem(researchWorkspaceStorageKey(pbId, selectedClientId));
      next = parseResearchWorkspaceState(raw, expected) ?? next;
    }
    setWorkspace(next);
    setEvidenceChecked(false);
    setMessage("");
  }, [pbId, selectedClientId]);

  useEffect(() => {
    if (workspace.pbId !== pbId || workspace.clientId !== selectedClientId || typeof window === "undefined") return;
    window.sessionStorage.setItem(
      researchWorkspaceStorageKey(pbId, selectedClientId),
      JSON.stringify(workspace),
    );
  }, [pbId, selectedClientId, workspace]);

  const previousSamsung = findSnapshot(RESEARCH_COPILOT_FIXTURE, "snapshot-samsung-2026-07");
  const currentSamsung = findSnapshot(RESEARCH_COPILOT_FIXTURE, "snapshot-samsung-2026-08");
  const comparison = previousSamsung && currentSamsung
    ? compareViewSnapshots(RESEARCH_COPILOT_FIXTURE, previousSamsung, currentSamsung, new Date().toISOString())
    : { changes: [], issues: [] };
  const currentValidation = validateSnapshots(RESEARCH_COPILOT_FIXTURE, workspace.draft.snapshotIds, new Date().toISOString());
  const currentSnapshots = CURRENT_SNAPSHOT_IDS
    .map((snapshotId) => findSnapshot(RESEARCH_COPILOT_FIXTURE, snapshotId))
    .filter((snapshot): snapshot is ResearchViewSnapshot => Boolean(snapshot));

  const activeClaim = activeClaimId ? findClaim(RESEARCH_COPILOT_FIXTURE, activeClaimId) : null;
  const activeSource = activeClaim ? documentById.get(activeClaim.sourceId) ?? null : null;

  const closeEvidence = useCallback(() => {
    setActiveClaimId(null);
    window.requestAnimationFrame(() => lastEvidenceTrigger.current?.focus());
  }, []);

  const openEvidence = useCallback((claimId: string, trigger: HTMLButtonElement) => {
    lastEvidenceTrigger.current = trigger;
    setActiveClaimId(claimId);
  }, []);

  const selectClient = (clientId: string) => {
    setSelectedClientId(clientId);
    const query = clientId === "book" ? "" : `?clientId=${encodeURIComponent(clientId)}`;
    router.replace(`/pb/${pbId}/research${query}`);
  };

  const updatePbMemo = (pbMemo: string) => {
    setWorkspace((current) => ({
      ...current,
      draft: {
        ...current.draft,
        pbMemo,
        status: current.draft.status === "approved" ? "draft" : current.draft.status,
        approvedAt: current.draft.status === "approved" ? null : current.draft.approvedAt,
        approvedBy: current.draft.status === "approved" ? null : current.draft.approvedBy,
        approvalManifestId: current.draft.status === "approved" ? null : current.draft.approvalManifestId,
      },
    }));
    if (workspace.draft.status === "approved") {
      setEvidenceChecked(false);
      setMessage("승인 후 메모가 변경되어 새 검토가 필요합니다. 이전 출력 기록은 보존됩니다.");
    }
  };

  const approve = () => {
    if (selectedClientId === "book" || !selectedClient) {
      setMessage("현재 PB에게 배정된 고객을 선택한 뒤 승인할 수 있습니다.");
      return;
    }
    const result = approveResearchDraft(workspace.draft, RESEARCH_COPILOT_FIXTURE, {
      pbId,
      clientId: selectedClientId,
      pbMemo: workspace.draft.pbMemo,
      evidenceChecked,
      nowIso: new Date().toISOString(),
      authorizedClientIds,
    });
    if (!result.ok) {
      setMessage(result.issues.map((issue) => issue.message).join(" "));
      return;
    }
    setWorkspace((current) => ({ ...current, draft: result.draft }));
    setMessage("PB 검토 승인이 완료되었습니다. 이 승인본만 상담 브리프 출력 기록을 만들 수 있습니다.");
  };

  const createOutput = () => {
    const record = createOutputRecord(workspace.draft, RESEARCH_COPILOT_FIXTURE, {
      pbId,
      clientId: selectedClientId,
      nowIso: new Date().toISOString(),
      authorizedClientIds,
    });
    if (!record) {
      setMessage("미승인·만료·근거 오류 상태이므로 고객 상담 브리프 출력을 차단했습니다.");
      return;
    }
    setWorkspace((current) => ({ ...current, outputs: appendOutputRecord(current.outputs, record) }));
    setMessage("승인본 출력 기록을 확인했습니다. 같은 승인본의 중복 실행은 한 건으로 보존됩니다.");
  };

  const outputAllowed = selectedClientId !== "book" && Boolean(selectedClient) && canConsumeResearchDraft(
    workspace.draft,
    RESEARCH_COPILOT_FIXTURE,
    { pbId, clientId: selectedClientId, nowIso: new Date().toISOString(), authorizedClientIds },
  );

  const onTabKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const currentIndex = TABS.findIndex((tab) => tab.id === view);
    const delta = event.key === "ArrowRight" ? 1 : -1;
    const next = TABS[(currentIndex + delta + TABS.length) % TABS.length];
    setView(next.id);
    window.requestAnimationFrame(() => document.getElementById(`research-tab-${next.id}`)?.focus());
  };

  const clientQuestions = useMemo(() => {
    const prefix = selectedClient ? `${selectedClient.name} 고객에게` : "고객에게";
    return [
      { text: `${prefix} 향후 현금화 일정과 단기 유동성 필요를 다시 확인합니다.`, claimId: "samsung-2026-08-stance" },
      { text: `${prefix} 보유자산 중 이익 가시성이 낮아진 자산이 있는지 확인합니다.`, claimId: "samsung-2026-08-driver" },
      { text: `${prefix} 주식·채권 동반 변동 시 감내 가능한 손실범위를 확인합니다.`, claimId: "samsung-2026-08-risk" },
    ];
  }, [selectedClient]);

  return (
    <div className="min-h-[calc(100vh-3.5rem)] bg-[#F5F7FC] px-3 py-4 text-[#0F172A] [color-scheme:light] sm:px-5 lg:px-6">
      <div className="mx-auto max-w-[1500px] space-y-4">
        <header className="rounded-2xl border border-[#DCE4F5] bg-white p-4 shadow-sm sm:p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[11px] font-black uppercase tracking-[0.14em] text-[#1428A0]">PB Research Copilot</p>
                <span className="rounded-full bg-[#E8ECFF] px-2 py-0.5 text-[10px] font-bold text-[#1428A0]">교육용 fixture</span>
              </div>
              <h1 className="mt-1 text-xl font-black tracking-tight sm:text-2xl">근거 중심 리서치 코파일럿</h1>
              <p className="mt-1 max-w-3xl text-xs leading-relaxed text-[#64748B] sm:text-sm">
                검증 규칙을 통과한 교육용 가상 문장을 보존하고, 같은 기관·자산군·전망기간만 결정론적으로 비교합니다. AI 설명은 숫자를 만들지 않으며 PB 승인 전 다른 기능과 고객 출력에 전달되지 않습니다.
              </p>
            </div>
            <label className="block min-w-0 lg:w-72">
              <span className="mb-1 block text-[11px] font-bold text-[#64748B]">상담 고객 문맥</span>
              <select
                value={selectedClientId}
                onChange={(event) => selectClient(event.target.value)}
                className="min-h-11 w-full rounded-lg border border-[#DCE4F5] bg-white px-3 text-sm font-semibold text-[#0F172A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2C3EE8]"
              >
                <option value="book">다고객 공통 브리핑</option>
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>{client.name} · {client.code}</option>
                ))}
              </select>
            </label>
          </div>
        </header>

        <div
          role="tablist"
          aria-label="리서치 코파일럿 보기"
          onKeyDown={onTabKeyDown}
          className="grid grid-cols-1 gap-2 rounded-2xl border border-[#DCE4F5] bg-white p-2 sm:grid-cols-3"
        >
          {TABS.map((tab) => {
            const selected = view === tab.id;
            return (
              <button
                key={tab.id}
                id={`research-tab-${tab.id}`}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={`research-panel-${tab.id}`}
                tabIndex={selected ? 0 : -1}
                onClick={() => setView(tab.id)}
                className={`min-h-14 rounded-xl px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2C3EE8] ${selected ? "bg-[#1428A0] text-white" : "bg-[#F0F3FA] text-[#0F172A] hover:bg-[#E8ECFF]"}`}
              >
                <span className="block text-sm font-black">{tab.label}</span>
                <span className={`mt-0.5 block text-[10px] ${selected ? "text-white/75" : "text-[#64748B]"}`}>{tab.description}</span>
              </button>
            );
          })}
        </div>

        {view === "briefing" && currentSamsung && (
          <section id="research-panel-briefing" role="tabpanel" aria-labelledby="research-tab-briefing" className="space-y-4">
            <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
              <article className="rounded-2xl border border-[#BFC9FF] bg-[#EEF1FF] p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div><p className="text-[11px] font-black text-[#1428A0]">당사 House View · 교육용 데모</p><h2 className="mt-1 text-lg font-black">이번 달 핵심 문장</h2></div>
                  <span className="rounded-full bg-white px-2 py-1 text-[10px] font-bold text-[#1428A0]">기준 2026-08-03</span>
                </div>
                <div className="mt-4 space-y-2">
                  <ClaimLine claimId={currentSamsung.stanceClaimId} onOpen={openEvidence} label="삼성 View" />
                  {currentSamsung.riskClaimIds.map((claimId) => <ClaimLine key={claimId} claimId={claimId} onOpen={openEvidence} label="새 위험 확인" />)}
                </div>
              </article>
              <article className="rounded-2xl border border-[#DCE4F5] bg-white p-5">
                <p className="text-[11px] font-black text-[#64748B]">근거 완전성</p>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div className="rounded-xl bg-[#F0F3FA] p-3"><p className="text-[10px] text-[#64748B]">검증된 핵심 문장</p><p className="mt-1 text-2xl font-black text-[#1428A0]">{workspace.draft.evidenceClaimIds.length}</p></div>
                  <div className="rounded-xl bg-[#F0F3FA] p-3"><p className="text-[10px] text-[#64748B]">출력 차단 사유</p><p className={`mt-1 text-2xl font-black ${workspace.draft.blockers.length + currentValidation.length ? "text-red-600" : "text-emerald-700"}`}>{workspace.draft.blockers.length + currentValidation.length}</p></div>
                </div>
                <p className="mt-3 text-xs leading-relaxed text-[#64748B]">발행일·기준일·페이지가 없거나 stale·충돌이면 해당 결과는 정상 카드로 표시하지 않고 출력도 차단합니다.</p>
              </article>
            </div>
            <article className="rounded-2xl border border-[#DCE4F5] bg-white p-5">
              <div><p className="text-[11px] font-black text-[#2C3EE8]">DETERMINISTIC DIFF</p><h2 className="mt-1 text-lg font-black">전월 대비 무엇이 바뀌었나</h2></div>
              {comparison.issues.length > 0 ? (
                <p className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">비교 조건 불일치 · 결과 차단</p>
              ) : (
                <div className="mt-4 grid gap-3 lg:grid-cols-2">
                  {comparison.changes.map((item) => (
                    <div key={item.changeId} className="rounded-xl border border-[#DCE4F5] bg-[#F5F7FC] p-4">
                      <p className="text-xs font-black text-[#1428A0]">{item.label}</p>
                      {item.before && <p className="mt-2 text-xs leading-relaxed text-[#64748B]"><b>이전</b> {item.before}</p>}
                      {item.after && <p className="mt-1 text-xs leading-relaxed text-[#0F172A]"><b>현재</b> {item.after}</p>}
                      <div className="mt-3 flex flex-wrap gap-2">
                        {item.evidenceClaimIds.map((claimId) => <EvidenceButton key={claimId} claimId={claimId} onOpen={openEvidence} label="비교 근거" />)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </article>
          </section>
        )}

        {view === "compare" && (
          <section id="research-panel-compare" role="tabpanel" aria-labelledby="research-tab-compare" className="space-y-4">
            <div className="rounded-xl border border-[#DCE4F5] bg-white p-4 text-xs leading-relaxed text-[#64748B]">
              기관 간 비교는 같은 월간·멀티에셋 범위만 나란히 보여줍니다. 공통점·차이는 판단 보조이며 합의 점수나 비중 확대 신호로 환산하지 않습니다.
            </div>
            <div className="grid gap-4 xl:grid-cols-2">{currentSnapshots.map((snapshot) => <SnapshotCard key={snapshot.snapshotId} snapshot={snapshot} onOpen={openEvidence} />)}</div>
          </section>
        )}

        {view === "client" && (
          <section id="research-panel-client" role="tabpanel" aria-labelledby="research-tab-client" className="space-y-4">
            <div className="grid gap-4 xl:grid-cols-2">
              <article className="rounded-2xl border border-[#DCE4F5] bg-white p-5">
                <p className="text-[11px] font-black text-[#1428A0]">1. 삼성 View · 출처 문장</p>
                <div className="mt-3 space-y-2">
                  {currentSamsung && claimIdsForSnapshot(currentSamsung).map((claimId) => <ClaimLine key={claimId} claimId={claimId} onOpen={openEvidence} />)}
                </div>
              </article>
              <article className="rounded-2xl border border-[#DCE4F5] bg-white p-5">
                <p className="text-[11px] font-black text-[#1428A0]">2. 고객 상담 확인 질문</p>
                {currentValidation.length > 0 ? (
                  <p className="mt-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">근거 누락·만료·충돌 상태이므로 파생 상담 질문을 표시하지 않습니다.</p>
                ) : <ul className="mt-3 space-y-2">
                  {clientQuestions.map((item, index) => (
                    <li key={item.text} className="flex items-start justify-between gap-3 rounded-lg bg-[#F5F7FC] p-3">
                      <p className="text-sm leading-relaxed"><b className="text-[#1428A0]">Q{index + 1}.</b> {item.text}</p>
                      <EvidenceButton claimId={item.claimId} onOpen={openEvidence} />
                    </li>
                  ))}
                </ul>}
              </article>
              <article className="rounded-2xl border border-[#C9D1FF] bg-[#EEF1FF] p-5">
                <p className="text-[11px] font-black text-[#2C3EE8]">3. AI 설명 · 결정론 결과만 설명</p>
                {currentValidation.length > 0 ? (
                  <p className="mt-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">근거 검증 실패 상태이므로 AI 설명을 표시하지 않습니다.</p>
                ) : <><p className="mt-3 text-sm leading-7 text-[#0F172A]">{workspace.draft.aiExplanation}</p>
                <div className="mt-3 flex flex-wrap gap-2">{workspace.draft.aiEvidenceClaimIds.slice(0, 4).map((claimId) => <EvidenceButton key={claimId} claimId={claimId} onOpen={openEvidence} label="설명 근거" />)}</div></>}
              </article>
              <article className="rounded-2xl border border-[#DCE4F5] bg-white p-5">
                <label htmlFor="pb-research-memo" className="text-[11px] font-black text-[#1428A0]">4. PB 메모 · 사람 판단</label>
                <textarea
                  id="pb-research-memo"
                  value={workspace.draft.pbMemo}
                  onChange={(event) => updatePbMemo(event.target.value)}
                  placeholder="예: 고객의 6개월 내 현금화 일정과 현재 채권 듀레이션을 상담에서 재확인"
                  className="mt-3 min-h-28 w-full resize-y rounded-xl border border-[#DCE4F5] bg-white p-3 text-sm leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2C3EE8]"
                />
              </article>
            </div>

            <article className="rounded-2xl border border-[#DCE4F5] bg-white p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <p className="text-sm font-black">승인·출력 통제</p>
                  <p className="mt-1 text-xs leading-relaxed text-[#64748B]">
                    현재 대상: {selectedClient ? `${selectedClient.name} · ${selectedClient.code}` : "고객 미선택"} · 상태 {currentValidation.length > 0 ? "blocked" : workspace.draft.status} · manifest {workspace.draft.evidenceManifestId}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={approve} disabled={!selectedClient} className="min-h-11 rounded-lg bg-[#2C3EE8] px-4 text-sm font-black text-white hover:bg-[#1428A0] disabled:cursor-not-allowed disabled:bg-[#94A3B8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2C3EE8] focus-visible:ring-offset-2">
                    PB 근거 검토 승인
                  </button>
                  <button type="button" onClick={createOutput} disabled={!outputAllowed} className="min-h-11 rounded-lg border border-[#1428A0] bg-white px-4 text-sm font-black text-[#1428A0] hover:bg-[#EEF1FF] disabled:cursor-not-allowed disabled:border-[#DCE4F5] disabled:text-[#94A3B8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2C3EE8]">
                    승인본 출력 기록 생성
                  </button>
                </div>
              </div>
              <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl bg-[#F5F7FC] p-3 text-sm">
                <input type="checkbox" checked={evidenceChecked} onChange={(event) => setEvidenceChecked(event.target.checked)} className="mt-0.5 h-4 w-4 accent-[#2C3EE8]" />
                <span><b>PB가 핵심 문장의 원문·기준일·페이지를 확인했습니다.</b><span className="mt-0.5 block text-xs text-[#64748B]">체크만으로 투자 적합성이 확정되는 것은 아닙니다.</span></span>
              </label>
              {message && <p role="status" className="mt-3 rounded-xl border border-[#DCE4F5] bg-[#F0F3FA] p-3 text-xs font-semibold text-[#0F172A]">{message}</p>}
              <p className="mt-3 text-[11px] text-[#64748B]">출력 기록 {workspace.outputs.length}건 · 실제 PDF 생성은 운영 권한·저작권·준법 승인 후 별도 구현합니다.</p>
            </article>
          </section>
        )}
      </div>

      <EvidenceDialog claim={activeClaim} source={activeSource} onClose={closeEvidence} />
    </div>
  );
}
