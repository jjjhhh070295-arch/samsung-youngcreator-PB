"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ACCOUNT_SEPARATION_LABEL, CLIENT_TYPE_LABEL } from "@/lib/types";
import type { Client, Consultation, CashFlow, PB, Portfolio, StageKey } from "@/lib/types";
import {
  getClient,
  listClients,
  listConsultations,
  listPbs,
  updateClient,
  deleteClient,
} from "@/lib/store";
import { formatKRW, formatDate, formatDateTime } from "@/lib/format";
import ConsultationModal from "@/components/ConsultationModal";
import ClientForm, { type ClientFormValue } from "@/components/ClientForm";
import ConfirmModal from "@/components/ConfirmModal";
import IPSResultTabs, { type Tab } from "@/components/IPSResultTabs";
import IPSRadar from "@/components/IPSRadar";
import TrendChart from "@/components/TrendChart";
import ConsultationHistory from "@/components/ConsultationHistory";
import { LoadingView, ErrorView } from "@/components/StateViews";
import HoldingsExtractor from "@/components/HoldingsExtractor";
import RealEstateModule from "@/components/RealEstateModule";
import AssetAllocationBar from "@/components/AssetAllocationBar";
import PartyRelationshipModule from "@/components/PartyRelationshipModule";
import TransferEventModule from "@/components/TransferEventModule";
import ClientAvatar from "@/components/ClientAvatar";

export default function ClientDetailPage() {
  const { pbId, clientId } = useParams<{ pbId: string; clientId: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeView = searchParams?.get("view") ?? "home";
  const activeTab = (searchParams?.get("tab") ?? "factors") as Tab;

  const [client, setClient] = useState<Client | null>(null);
  const [allClients, setAllClients] = useState<Client[]>([]);
  const [consultations, setConsultations] = useState<Consultation[]>([]);
  const [pbs, setPbs] = useState<PB[]>([]);
  const [status, setStatus] = useState<"loading" | "error" | "ready">("loading");
  const [modalOpen, setModalOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const [c, cons, allPbs, clients] = await Promise.all([
        getClient(clientId),
        listConsultations(clientId),
        listPbs(),
        listClients(),
      ]);
      if (!c) { setStatus("error"); return; }
      setClient(c);
      setAllClients(clients);
      setConsultations(cons);
      setPbs(allPbs);
      setStatus("ready");
    } catch (e) {
      console.error(e);
      setStatus("error");
    }
  }, [clientId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const hash = window.location.hash;
    if (!hash) return;
    const el = document.getElementById(hash.replace("#", ""));
    if (el) el.scrollIntoView({ behavior: "smooth" });
  }, [activeView]);

  const handleSetTab = (t: Tab) => {
    router.push(`/pb/${pbId}/${clientId}?view=analysis&tab=${t}`, { scroll: false });
  };

  const saveCashFlows = async (flows: CashFlow[]) => {
    if (!client) return;
    await updateClient(client.id, { cashFlows: flows });
    setClient({ ...client, cashFlows: flows });
  };

  const savePortfolios = async (portfolios: Portfolio[]) => {
    if (!client) return;
    await updateClient(client.id, { portfolios });
    setClient({ ...client, portfolios });
  };

  const finalizePortfolio = async (portfolio: Portfolio) => {
    if (!client) return;
    const stages = { ...(client.stages ?? {}), portfolio: true };
    await updateClient(client.id, { portfolios: [portfolio], stages });
    setClient({ ...client, portfolios: [portfolio], stages });
  };

  const unfinalizePortfolio = async () => {
    if (!client) return;
    const stages = { ...(client.stages ?? {}), portfolio: false, stress: false };
    await updateClient(client.id, { stages });
    setClient({ ...client, stages });
  };

  const toggleStage = async (key: StageKey) => {
    if (!client) return;
    const stages = { ...(client.stages ?? {}), [key]: !client.stages?.[key] };
    await updateClient(client.id, { stages });
    setClient({ ...client, stages });
  };

  const submitEdit = async (v: ClientFormValue) => {
    if (!client) return;
    await updateClient(client.id, {
      code: v.code,
      clientType: v.clientType,
      name: v.name,
      birthDate: v.birthDate,
      assignedPbId: v.assignedPbId,
      assetSize: v.assetSize,
      linkedClientId: v.linkedClientId,
      ownershipPct: v.ownershipPct,
      isMajorityShareholder: v.isMajorityShareholder,
      accountSeparation: v.accountSeparation,
    });
    await load();
    if (v.assignedPbId && v.assignedPbId !== pbId) {
      router.replace(`/pb/${v.assignedPbId}/${client.id}`);
    }
  };

  const confirmDelete = async () => {
    if (!client) return;
    await deleteClient(client.id);
    router.push(`/pb/${pbId}`);
  };

  if (status === "loading") return <LoadingView />;
  if (status === "error" || !client)
    return <ErrorView message="고객 정보를 불러올 수 없습니다." onRetry={load} />;

  const lastConsultedAt =
    consultations.length > 0
      ? consultations.slice().sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1))[0].createdAt
      : "";
  const linkedClient = allClients.find((item) => item.id === client?.linkedClientId) ?? null;
  const completedStages = Object.values(client.stages ?? {}).filter(Boolean).length;
  const totalStages = Object.keys(client.stages ?? {}).length;
  const riskProfile = client.ips?.risk?.value?.trim();

  return (
    <div className="mx-auto max-w-[1680px] space-y-5 px-4 py-4 lg:px-6">
      <section className="console-panel overflow-hidden bg-gradient-to-r from-white via-white to-[#F2F5FF]">
        <div className="flex flex-wrap items-center justify-between gap-4 p-5">
          <div className="flex min-w-0 items-center gap-4">
            <ClientAvatar name={client.name} type={client.clientType} size="lg" />
            <div className="min-w-0">
              <div className="flex flex-wrap gap-1.5"><span className="badge-navy font-mono">{client.code}</span><span className="badge-muted">{CLIENT_TYPE_LABEL[client.clientType]}</span>{client.isMajorityShareholder && <span className="badge-warning">최대주주</span>}</div>
              <h1 className="mt-2 truncate text-2xl font-black tracking-tight text-fg">{client.name}</h1>
              <p className="mt-1 text-xs text-fg-muted">Customer 360 · AUM <b className="text-[#1428A0]">{formatKRW(client.assetSize)}</b>{riskProfile ? ` · ${riskProfile}` : ""}</p>
            </div>
          </div>
          <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-3 lg:w-auto lg:min-w-[480px]">
            <div className="console-metric">
              <div className="flex items-center justify-between"><p className="console-label">상담 진행률</p><p className="text-sm font-black text-[#1428A0]">{completedStages}/{totalStages || "—"}</p></div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#DCE4F5]"><div className="h-full rounded-full bg-[#1428A0]" style={{ width: `${totalStages ? Math.round((completedStages / totalStages) * 100) : 0}%` }} /></div>
            </div>
            <div className="console-metric"><p className="console-label">마지막 상담</p><p className="mt-1 text-sm font-bold text-fg">{lastConsultedAt ? formatDate(lastConsultedAt) : "기록 없음"}</p></div>
            <div className="console-metric"><p className="console-label">현재 상태</p><p className="mt-1 text-sm font-bold text-fg">{client.stages?.portfolio ? "포트폴리오 확정" : "분석 진행 중"}</p></div>
          </div>
        </div>
      </section>

      {/* 기본 정보 */}
      {activeView === "home" && <>
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-fg-muted mb-3 flex items-center gap-2">
            <span>👤</span> 기본 정보
          </h2>
          <div className="console-panel p-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="badge-gold font-mono">{client.code}</span>
                  <span className={client.clientType === "corporate" ? "badge-navy" : "badge-muted"}>
                    {CLIENT_TYPE_LABEL[client.clientType]}
                  </span>
                  {client.isMajorityShareholder && <span className="badge-gold">최대주주</span>}
                </div>
                <h1 className="text-lg font-bold text-fg">고객 기본 프로필</h1>
                <p className="mt-1 text-sm text-fg-muted">
                  {client.clientType === "corporate" ? "설립일" : "생년월일"}{" "}
                  {formatDate(client.birthDate)} · 자산규모{" "}
                  <b className="text-[#1428A0]">{formatKRW(client.assetSize)}</b>
                </p>
                {(linkedClient || client.accountSeparation) && (
                  <p className="mt-1 text-xs text-fg-muted">
                    {linkedClient && (
                      <>연동 고객 <b className="text-fg">{linkedClient.name}</b>
                        {client.ownershipPct != null && ` · 지분율 ${client.ownershipPct}%`}
                      </>
                    )}
                    {linkedClient && client.accountSeparation && " · "}
                    {client.accountSeparation && (
                      <>통장 분리 <b className="text-fg">{ACCOUNT_SEPARATION_LABEL[client.accountSeparation]}</b></>
                    )}
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                <button className="btn-outline text-sm" onClick={() => setEditOpen(true)}>수정</button>
                <button className="btn-ghost text-sm text-red-500" onClick={() => setDeleteOpen(true)}>삭제</button>
              </div>
            </div>
            <AssetAllocationBar clientId={clientId} totalAsset={client.assetSize ?? 0} />
          </div>
        </section>

        {/* MTS 보유종목 추출 */}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-fg-muted mb-3 flex items-center gap-2">
            <span>📊</span> 보유종목 (MTS 캡쳐 추출)
          </h2>
          <div className="card p-5">
            <HoldingsExtractor clientId={clientId} />
          </div>
        </section>

        {/* 부동산 자산 */}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-fg-muted mb-3 flex items-center gap-2">
            <span>🏠</span> 부동산 자산
          </h2>
          <div className="card p-5">
            <RealEstateModule clientId={clientId} />
          </div>
        </section>

        {/* 관계 네트워크 */}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-fg-muted mb-3 flex items-center gap-2">
            <span>🔗</span> 관계 네트워크
          </h2>
          <div className="card p-5">
            <PartyRelationshipModule
              partyId={clientId}
              partyType={client.clientType === "corporate" ? "corporate" : "individual"}
            />
          </div>
        </section>

        {/* 증여·상속 이력 */}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-fg-muted mb-3 flex items-center gap-2">
            <span>📋</span> 증여·상속 이력
          </h2>
          <div className="card p-5">
            <TransferEventModule partyId={clientId} partyName={client.name} />
          </div>
        </section>
      </>}

      {/* 상담 진행 */}
      {activeView === "consultation" && (<>
        {/* 1. 상담 현황 바 */}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-fg-muted mb-3 flex items-center gap-2">
            <span>📝</span> 상담 진행
          </h2>
          <div className="card p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-base font-semibold text-fg">상담 현황</p>
                <p className="text-xs text-fg-muted mt-0.5">
                  {lastConsultedAt
                    ? `최근 상담: ${formatDateTime(lastConsultedAt)} · 총 ${consultations.length}건`
                    : "아직 진행한 상담이 없습니다. 첫 상담을 시작해 보세요."}
                </p>
              </div>
              <button className="btn-primary text-sm px-4" onClick={() => setModalOpen(true)}>
                + 새 상담
              </button>
            </div>
          </div>
        </section>

        {/* 2. 성향 변화 추세 그래프 */}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-fg-muted mb-3 flex items-center gap-2">
            <span>📈</span> 성향 변화 추세
          </h2>
          <div className="card p-4">
            <TrendChart consultations={consultations} />
          </div>
        </section>

        {/* 3. 상담 이력 — 항상 펼쳐서 카드 나열 */}
        {consultations.length > 0 && (
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-fg-muted mb-3 flex items-center gap-2">
              <span>📋</span> 상담 이력 ({consultations.length}건)
            </h2>
            <ConsultationHistory consultations={consultations} client={client} onSaved={load} />
          </section>
        )}
      </>)}

      {/* 분석 */}
      {activeView === "analysis" && (
        <IPSResultTabs
          client={client}
          allClients={allClients}
          pbId={pbId}
          clientId={clientId}
          tab={activeTab}
          onSetTab={handleSetTab}
          onEdit={() => setModalOpen(true)}
          onSaveCashFlows={saveCashFlows}
          onSavePortfolios={savePortfolios}
          onFinalizePortfolio={finalizePortfolio}
          onUnfinalizePortfolio={unfinalizePortfolio}
          onToggleStage={toggleStage}
          linkedClient={linkedClient}
        />
      )}

      {/* 성향 시각화 */}
      {activeView === "visualization" && (
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-fg-muted mb-3 flex items-center gap-2">
            <span>📈</span> 성향 시각화
          </h2>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div>
              <p className="text-xs text-fg-muted mb-2">현재 성향 (레이더)</p>
              <div className="card p-4"><IPSRadar ips={client.ips} /></div>
            </div>
            <div>
              <p className="text-xs text-fg-muted mb-2">성향 변화 추세</p>
              <div className="card p-4"><TrendChart consultations={consultations} /></div>
            </div>
          </div>
        </section>
      )}

      {/* 모달들 */}
      <ConsultationModal
        open={modalOpen}
        client={client}
        pbId={pbId}
        onClose={() => setModalOpen(false)}
        onSaved={async () => { setModalOpen(false); await load(); }}
      />
      <ClientForm
        open={editOpen}
        initial={client}
        pbs={pbs}
        clients={allClients}
        suggestedCode={client.code}
        onSubmit={submitEdit}
        onClose={() => setEditOpen(false)}
      />
      <ConfirmModal
        open={deleteOpen}
        title="고객을 삭제할까요?"
        danger
        confirmLabel="삭제"
        description={
          <>
            <b>{client.name}</b> ({client.code})와 관련 상담 이력이 <b>모두 삭제</b>됩니다.
            되돌릴 수 없습니다.
          </>
        }
        onConfirm={confirmDelete}
        onCancel={() => setDeleteOpen(false)}
      />
    </div>
  );
}
