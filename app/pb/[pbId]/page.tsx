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
import { PbTodayTodos } from "@/components/advisory/PbTodayTodos";
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
    <div className="pb-console mx-auto max-w-[1440px] space-y-1.5 px-3 py-3 sm:px-4 lg:px-8">
      {/* 헤더 */}
      <div className="flex flex-wrap items-end justify-between gap-4 pb-2">
          <div>
            <Link href="/" className="text-[11px] font-semibold text-[#1428A0] hover:underline">PB Home</Link>
            <h1 className="mt-1 text-[26px] font-black tracking-[-0.035em] text-[#161A22]">PB Home</h1>
            <p className="text-xs text-fg-muted">{pb.name} PB · 담당 고객과 오늘의 상담 일정을 관리합니다.</p>
            <span className="mt-1 block h-[3px] w-7 rounded bg-[#1769D2]" aria-hidden="true" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link className="pb-control" href={`/pb/${pbId}/briefing`}>
              모닝 브리핑
            </Link>
            <button className="btn-outline px-3 py-2 text-xs" onClick={() => setConsultScheduleOpen(true)}>
              상담일정 예약
            </button>
            <button className="hidden btn-outline px-3 py-2 text-xs sm:inline-flex" onClick={() => setExtraEventOpen(true)}>
              기타일정 추가
            </button>
            <button className="btn-primary rounded bg-[#1769D2] px-4 py-2 text-xs hover:bg-[#0D57BA]" onClick={() => setClientFormOpen(true)}>+ 고객 추가</button>
            <button className="hidden btn-ghost px-2 py-2 text-xs xl:inline-flex" onClick={() => setPbFormOpen(true)}>
              PB 정보 수정
            </button>
            <button
              className="hidden btn-ghost px-2 py-2 text-xs text-red-500 xl:inline-flex"
              onClick={() => setPbDeleteOpen(true)}
            >
              PB 삭제
            </button>
          </div>
      </div>

      <section aria-label="PB 요약">
        <PBDashboard clients={myClients} consultations={myConsultations} investableAum={investableAum} />
      </section>

      <PbTodayTodos pbId={pbId} refreshKey={scheduleRefreshKey} />

      <BookDashboard pbId={pbId} rows={bookRows} />

      <div className="grid border border-border bg-white md:grid-cols-3">
          <section className="relative border-b border-border p-4 md:border-b-0 md:border-r">
            <span className="absolute left-4 top-2 h-[3px] w-16 rounded bg-[#1769D2]" aria-hidden="true" />
            <div className="flex items-center justify-between">
              <div><p className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-[#1428A0]">Book Insight</p><h2 className="mt-0.5 text-sm font-black text-fg">고객 구성</h2></div>
              <span className="badge-muted">총 {myClients.length}명</span>
            </div>
            <div className="mt-3 flex h-1.5 overflow-hidden rounded-full bg-slate-100" aria-label="고객 유형 구성">
              {myClients.length > 0 && <>
                <span className="bg-[#1769D2]" style={{ width: `${myClients.filter((c) => c.clientType === "individual").length / myClients.length * 100}%` }} />
                <span className="bg-[#84B2EE]" style={{ width: `${myClients.filter((c) => c.clientType === "corporate").length / myClients.length * 100}%` }} />
                <span className="bg-slate-400" style={{ width: `${myClients.filter((c) => c.clientType === "sole_proprietor").length / myClients.length * 100}%` }} />
              </>}
            </div>
            <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-xs text-slate-600">
              <span><i className="mr-1.5 inline-block h-2 w-2 rounded-full bg-[#1428A0]" />개인 {myClients.filter((c) => c.clientType === "individual").length}명</span>
              <span><i className="mr-1.5 inline-block h-2 w-2 rounded-full bg-[#2563EB]" />법인 {myClients.filter((c) => c.clientType === "corporate").length}명</span>
              <span><i className="mr-1.5 inline-block h-2 w-2 rounded-full bg-slate-400" />개인사업자 {myClients.filter((c) => c.clientType === "sole_proprietor").length}명</span>
            </div>
          </section>
          <section className="relative border-b border-border p-4 md:border-b-0 md:border-r">
            <span className="absolute left-4 top-2 h-1.5 w-1.5 rounded-full bg-[#1769D2]" aria-hidden="true" />
            <div className="flex items-center justify-between"><h2 className="text-sm font-bold text-fg">최근 상담 고객</h2><span className="text-[11px] text-fg-muted">최근 {Math.min(5, myConsultations.length)}건</span></div>
            {myConsultations.length > 0 ? <ul className="mt-3 space-y-2">{myConsultations.slice().sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1)).slice(0, 5).map((consultation) => { const target = myClients.find((client) => client.id === consultation.clientId); return target ? <li key={consultation.id} className="flex items-center justify-between gap-3 border-b border-border/60 pb-2 last:border-0 last:pb-0"><button className="flex min-w-0 items-center gap-2.5 text-left" onClick={() => router.push(`/pb/${pbId}/${target.id}?view=consultation`)}><ClientAvatar name={target.name} type={target.clientType} size="sm" /><span className="min-w-0"><span className="block truncate text-xs font-bold text-fg">{target.name}</span><span className="text-[10px] text-fg-muted">{new Date(consultation.createdAt).toLocaleDateString("ko-KR")}</span></span></button><span className="badge-muted">상담 보기</span></li> : null; })}</ul> : <p className="mt-3 rounded-lg bg-slate-50 px-3 py-4 text-xs text-fg-muted">아직 기록된 상담이 없습니다.</p>}
          </section>
          <section className="relative p-4">
            <h2 className="text-sm font-bold text-fg">가문 관리</h2>
            <p className="mt-2 text-sm font-black text-[#0D57BA]">가문 관리 열기 →</p>
            <p className="mt-1 text-[11px] text-fg-muted">가문 구성과 연결 고객을 관리합니다.</p>
            <a href="#household-management" className="absolute inset-0" aria-label="가문 관리로 이동" />
          </section>
      </div>

      {/* 가문 관리 */}
      <div id="household-management" className="pt-3">
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
