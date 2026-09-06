"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import type { PB, Client, Consultation } from "@/lib/types";
import {
  listPbs,
  listClients,
  listAllConsultations,
  updatePb,
  deletePb,
  createClient,
  nextClientCode,
  listOwnershipRelationshipsBulk,
  listFamilyRelationshipsBulk,
  listRealEstateWithDebtBulk,
  listGiftEventsBulk,
} from "@/lib/store";
import PBDashboard from "@/components/PBDashboard";
import ClientForm, { type ClientFormValue } from "@/components/ClientForm";
import PBForm from "@/components/PBForm";
import ConfirmModal from "@/components/ConfirmModal";
import { LoadingView, ErrorView } from "@/components/StateViews";
import HouseholdModule from "@/components/HouseholdModule";
import BookDashboard from "@/components/advisory/BookDashboard";
import ConsultationScheduleModal from "@/components/advisory/ConsultationScheduleModal";
import ExtraEventModal from "@/components/advisory/ExtraEventModal";
import ClientAvatar from "@/components/ClientAvatar";
import { buildClientBookRow } from "@/lib/advisory/book";
import { listBookHoldings } from "@/lib/advisory/holdingsStore";
import { resolveHeritageInputsBulk } from "@/lib/heritage";
import { resolveAssetBreakdownBulk } from "@/lib/assets";

export default function PBPage() {
  const { pbId } = useParams<{ pbId: string }>();
  const router = useRouter();

  const [pb, setPb] = useState<PB | null>(null);
  const [allClients, setAllClients] = useState<Client[]>([]);
  const [pbs, setPbs] = useState<PB[]>([]);
  const [consultations, setConsultations] = useState<Consultation[]>([]);
  const [status, setStatus] = useState<"loading" | "error" | "ready">("loading");

  const [clientFormOpen, setClientFormOpen] = useState(false);

  const [pbFormOpen, setPbFormOpen] = useState(false);
  const [pbDeleteOpen, setPbDeleteOpen] = useState(false);
  const [bookRows, setBookRows] = useState<ReturnType<typeof buildClientBookRow>[]>([]);
  const [scheduleRefreshKey, setScheduleRefreshKey] = useState(0);
  const [consultScheduleOpen, setConsultScheduleOpen] = useState(false);
  const [extraEventOpen, setExtraEventOpen] = useState(false);
  const [investableAum, setInvestableAum] = useState(0);

  const refreshSchedules = useCallback(() => {
    setScheduleRefreshKey((key) => key + 1);
  }, []);

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const [allPbs, clients, cons] = await Promise.all([
        listPbs(),
        listClients(),
        listAllConsultations(),
      ]);
      setPbs(allPbs);
      setPb(allPbs.find((p) => p.id === pbId) ?? null);
      setAllClients(clients);
      setConsultations(cons);
      const mine = clients.filter((c) => c.assignedPbId === pbId);
      const holdings = await listBookHoldings(mine.map((c) => c.id));
      const asOf = new Date().toISOString();

      // 헤리티지 판정 입력을 벌크로 조립 — 고객 한 명마다 쿼리를 새로 날리지 않고 4개 쿼리로
      // 전체를 가져온다(lib/heritage/resolveBulk.ts 참고). 개인 고객만 대상.
      const individualIds = mine.filter((c) => c.clientType === "individual").map((c) => c.id);
      const [ownershipRelationships, familyRelationships, realEstate, giftEvents] = await Promise.all([
        listOwnershipRelationshipsBulk(individualIds),
        listFamilyRelationshipsBulk(individualIds),
        listRealEstateWithDebtBulk(individualIds),
        listGiftEventsBulk(individualIds),
      ]);
      const { heritageInputs } = resolveHeritageInputsBulk({
        allClients: clients,
        targetClientIds: individualIds,
        ownershipRelationships,
        familyRelationships,
        realEstate,
        giftEvents,
        asOf: new Date(asOf),
      });

      const rows = mine.map((c) => buildClientBookRow(c, holdings, cons, asOf, heritageInputs.get(c.id)));
      setBookRows(rows);
      setStatus("ready");
    } catch (e) {
      console.error(e);
      setStatus("error");
    }
  }, [pbId]);

  useEffect(() => {
    load();
  }, [load]);

  // 대시보드 AUM = 부동산 제외 합계. assetSize 합계와 다르다.
  useEffect(() => {
    const mine = allClients.filter((c) => c.assignedPbId === pbId);
    if (mine.length === 0) { setInvestableAum(0); return; }
    let cancelled = false;
    resolveAssetBreakdownBulk(mine.map((c) => c.id))
      .then((map) => {
        if (cancelled) return;
        const sum = Array.from(map.values()).reduce((s, b) => s + b.investableKrw, 0);
        setInvestableAum(sum);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [allClients, pbId]);

  useEffect(() => {
    refreshSchedules();
  }, [refreshSchedules]);

  const myClients = allClients.filter((c) => c.assignedPbId === pbId);
  const myClientIds = new Set(myClients.map((c) => c.id));
  const myConsultations = consultations.filter((c) => myClientIds.has(c.clientId));

  const submitClient = async (v: ClientFormValue) => {
    await createClient(v);
    await load();
  };

  const handleScheduleSaved = async () => {
    refreshSchedules();
    await load();
  };

  const confirmDeletePb = async () => {
    if (!pb) return;
    await deletePb(pb.id);
    setPbDeleteOpen(false);
    router.push("/");
  };

  if (status === "loading") return <LoadingView />;
  if (status === "error") return <ErrorView onRetry={load} />;
  if (!pb)
    return (
      <ErrorView
        message="해당 PB를 찾을 수 없습니다."
        onRetry={() => router.push("/")}
      />
    );

  return (
    <div className="mx-auto max-w-[1800px] space-y-4 px-4 py-4 lg:px-6">
      {/* 헤더 */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
          <div>
            <Link href="/" className="text-[11px] font-semibold text-[#1428A0] hover:underline">PB Home</Link>
            <h1 className="mt-1 text-xl font-black tracking-tight text-fg">고객조회</h1>
            <p className="mt-0.5 text-xs text-fg-muted">{pb.name} PB · 담당 고객을 검색·필터·정렬하여 관리합니다.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="btn-outline text-sm" onClick={() => setConsultScheduleOpen(true)}>
              상담일정 예약
            </button>
            <button className="btn-outline text-sm" onClick={() => setExtraEventOpen(true)}>
              기타일정 추가
            </button>
            <button className="btn-primary text-sm" onClick={() => setClientFormOpen(true)}>+ 고객 추가</button>
            <Link className="btn-outline text-sm" href={`/pb/${pbId}/briefing`}>
              모닝 브리핑
            </Link>
            <button className="btn-outline text-sm" onClick={() => setPbFormOpen(true)}>
              PB 정보 수정
            </button>
            <button
              className="btn-ghost text-sm text-red-500"
              onClick={() => setPbDeleteOpen(true)}
            >
              PB 삭제
            </button>
          </div>
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-12">
        <div className="min-w-0 xl:col-span-9">
          <BookDashboard pbId={pbId} rows={bookRows} scheduleRefreshKey={scheduleRefreshKey} />
        </div>
        {/* sticky 오프셋 = 상단 네비 1행(h-11 = 2.75rem) + 여백(1rem). 헤더 줄은 제거됨 */}
        <aside className="space-y-4 xl:col-span-3 xl:sticky xl:top-[3.75rem]">
          <section className="card p-3">
            <div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-bold text-fg">핵심 KPI</h2><span className="badge-muted">실시간 현황</span></div>
            <PBDashboard clients={myClients} consultations={myConsultations} investableAum={investableAum} />
          </section>
          <section className="card p-4">
            <div className="flex items-center justify-between"><h2 className="text-sm font-bold text-fg">최근 상담 고객</h2><span className="text-[11px] text-fg-muted">최근 {Math.min(5, myConsultations.length)}건</span></div>
            {myConsultations.length > 0 ? <ul className="mt-3 space-y-2">{myConsultations.slice().sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1)).slice(0, 5).map((consultation) => { const target = myClients.find((client) => client.id === consultation.clientId); return target ? <li key={consultation.id} className="flex items-center justify-between gap-3 border-b border-border/60 pb-2 last:border-0 last:pb-0"><button className="flex min-w-0 items-center gap-2.5 text-left" onClick={() => router.push(`/pb/${pbId}/${target.id}?view=consultation`)}><ClientAvatar name={target.name} type={target.clientType} size="sm" /><span className="min-w-0"><span className="block truncate text-xs font-bold text-fg">{target.name}</span><span className="text-[10px] text-fg-muted">{new Date(consultation.createdAt).toLocaleDateString("ko-KR")}</span></span></button><span className="badge-muted">상담 보기</span></li> : null; })}</ul> : <p className="mt-3 text-xs text-fg-muted">기록된 상담이 없습니다.</p>}
          </section>
        </aside>
      </div>

      {/* 가문 관리 */}
      <div>
        <h2 className="text-sm font-semibold text-fg-muted mb-3">가문 관리</h2>
        <div className="card p-5">
          <HouseholdModule pbId={pbId} />
        </div>
      </div>

      {/* 모달들 */}
      <ClientForm
        open={clientFormOpen}
        initial={null}
        pbs={pbs}
        clients={allClients}
        defaultPbId={pbId}
        suggestedCode={nextClientCode(allClients)}
        onSubmit={submitClient}
        onClose={() => setClientFormOpen(false)}
      />

      <PBForm
        open={pbFormOpen}
        initial={pb}
        onSubmit={async (name) => {
          await updatePb(pb.id, { name });
          await load();
        }}
        onClose={() => setPbFormOpen(false)}
      />

      <ConfirmModal
        open={pbDeleteOpen}
        title="PB를 삭제할까요?"
        danger
        confirmLabel="삭제"
        description={
          <>
            <b>{pb.name}</b> PB를 삭제합니다. 담당 고객 {myClients.length}명은
            삭제되지 않고 <b>담당 PB 미지정</b>으로 바뀝니다.
          </>
        }
        onConfirm={confirmDeletePb}
        onCancel={() => setPbDeleteOpen(false)}
      />

      <ConsultationScheduleModal
        open={consultScheduleOpen}
        pbId={pbId}
        clients={myClients}
        pbs={pbs}
        allClients={allClients}
        onClose={() => setConsultScheduleOpen(false)}
        onSaved={handleScheduleSaved}
      />

      <ExtraEventModal
        open={extraEventOpen}
        pbId={pbId}
        onClose={() => setExtraEventOpen(false)}
        onSaved={refreshSchedules}
      />
    </div>
  );
}
