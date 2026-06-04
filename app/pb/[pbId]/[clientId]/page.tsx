"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import type { Client, Consultation, CashFlow, PB, Portfolio, StageKey } from "@/lib/types";
import {
  getClient,
  listConsultations,
  listPbs,
  updateClient,
  deleteClient,
} from "@/lib/store";
import { formatKRW, formatDate, formatDateTime } from "@/lib/format";
import ConsultationModal from "@/components/ConsultationModal";
import ClientForm, { type ClientFormValue } from "@/components/ClientForm";
import ConfirmModal from "@/components/ConfirmModal";
import IPSResultTabs from "@/components/IPSResultTabs";
import IPSRadar from "@/components/IPSRadar";
import TrendChart from "@/components/TrendChart";
import ConsultationHistory from "@/components/ConsultationHistory";
import { LoadingView, ErrorView } from "@/components/StateViews";

export default function ClientDetailPage() {
  const { pbId, clientId } = useParams<{ pbId: string; clientId: string }>();
  const router = useRouter();

  const [client, setClient] = useState<Client | null>(null);
  const [consultations, setConsultations] = useState<Consultation[]>([]);
  const [pbs, setPbs] = useState<PB[]>([]);
  const [status, setStatus] = useState<"loading" | "error" | "ready">("loading");
  const [modalOpen, setModalOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const [c, cons, allPbs] = await Promise.all([
        getClient(clientId),
        listConsultations(clientId),
        listPbs(),
      ]);
      if (!c) {
        setStatus("error");
        return;
      }
      setClient(c);
      setConsultations(cons);
      setPbs(allPbs);
      setStatus("ready");
    } catch (e) {
      console.error(e);
      setStatus("error");
    }
  }, [clientId]);

  useEffect(() => {
    load();
  }, [load]);

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
    });
    await load();
    // 담당 PB가 바뀌면 현재 URL의 pbId와 달라지므로 새 경로로 이동
    if (v.assignedPbId && v.assignedPbId !== pbId) {
      router.replace(`/pb/${v.assignedPbId}/${client.id}`);
    }
  };

  const confirmDelete = async () => {
    if (!client) return;
    await deleteClient(client.id);
    router.push(`/pb/${pbId}`);
  };

  const lastConsultedAt =
    consultations.length > 0
      ? consultations.slice().sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1))[0].createdAt
      : "";

  if (status === "loading") return <LoadingView />;
  if (status === "error" || !client)
    return <ErrorView message="고객 정보를 불러올 수 없습니다." onRetry={load} />;

  return (
    <div className="space-y-6">
      {/* 헤더 + 기본정보 */}
      <div>
        <button
          className="text-xs text-fg-muted hover:text-fg"
          onClick={() => router.push(`/pb/${pbId}`)}
        >
          ← PB 페이지
        </button>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="badge-gold font-mono">{client.code}</span>
              <span className={client.clientType === "corporate" ? "badge-navy" : "badge-muted"}>
                {client.clientType === "corporate" ? "법인" : "개인"}
              </span>
            </div>
            <h1 className="mt-2 text-2xl font-bold text-fg">{client.name}</h1>
            <p className="mt-1 text-sm text-fg-muted">
              {client.clientType === "corporate" ? "설립일" : "생년월일"}{" "}
              {formatDate(client.birthDate)} · 자산규모{" "}
              <b className="text-gold-600 dark:text-gold-300">{formatKRW(client.assetSize)}</b>
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <button
              className="btn-primary text-sm"
              onClick={() => router.push(`/client/${client.id}`)}
            >
              고객 화면 →
            </button>
            <div className="flex gap-2">
              <button className="btn-outline text-sm" onClick={() => setEditOpen(true)}>
                정보 수정
              </button>
              <button
                className="btn-ghost text-sm text-red-500"
                onClick={() => setDeleteOpen(true)}
              >
                삭제
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── 상담 진행 + 이력 조회 ── */}
      <section className="rounded-xl border-2 border-gold-400/60 bg-gradient-to-r from-surface to-gold-50/40 p-5 shadow-card dark:to-gold-900/10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="text-2xl">📝</span>
            <div>
              <h2 className="text-base font-bold text-fg">상담 진행</h2>
              <p className="text-xs text-fg-muted">
                {lastConsultedAt
                  ? `최근 상담: ${formatDateTime(lastConsultedAt)} · 총 ${consultations.length}건`
                  : "아직 진행한 상담이 없습니다. 첫 상담을 시작해 보세요."}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              className="btn-outline text-sm"
              onClick={() => setHistoryOpen((v) => !v)}
              disabled={consultations.length === 0}
            >
              상담 이력 {consultations.length}건 {historyOpen ? "▲" : "▼"}
            </button>
            <button className="btn-gold px-5 py-2.5 text-sm" onClick={() => setModalOpen(true)}>
              + 새 상담 시작
            </button>
          </div>
        </div>

        {/* 상담 이력 (펼침) */}
        {historyOpen && (
          <div className="mt-4 border-t border-border pt-4">
            <ConsultationHistory consultations={consultations} client={client} onSaved={load} />
          </div>
        )}
      </section>

      {/* 상담 전 과정 탭 (7요인·플래그·추가질문·현금흐름·포트폴리오·스트레스·IPS) */}
      <section>
        <h2 className="mb-2 text-sm font-semibold text-fg-muted">상담 과정</h2>
        <IPSResultTabs
          client={client}
          onEdit={() => setModalOpen(true)}
          onSaveCashFlows={saveCashFlows}
          onSavePortfolios={savePortfolios}
          onToggleStage={toggleStage}
        />
      </section>

      {/* 시각화 */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div>
          <h2 className="mb-2 text-sm font-semibold text-fg-muted">현재 성향 (레이더)</h2>
          <div className="card p-4">
            <IPSRadar ips={client.ips} />
          </div>
        </div>
        <div>
          <h2 className="mb-2 text-sm font-semibold text-fg-muted">성향 변화 추세</h2>
          <div className="card p-4">
            <TrendChart consultations={consultations} />
          </div>
        </div>
      </section>

      {/* 상담 모달 */}
      <ConsultationModal
        open={modalOpen}
        client={client}
        pbId={pbId}
        onClose={() => setModalOpen(false)}
        onSaved={async () => {
          setModalOpen(false);
          await load();
        }}
      />

      {/* 고객 정보 수정 */}
      <ClientForm
        open={editOpen}
        initial={client}
        pbs={pbs}
        suggestedCode={client.code}
        onSubmit={submitEdit}
        onClose={() => setEditOpen(false)}
      />

      {/* 고객 삭제 */}
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
