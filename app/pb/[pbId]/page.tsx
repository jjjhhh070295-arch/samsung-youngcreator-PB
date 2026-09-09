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
import BookDashboard from "@/components/advisory/BookDashboard";
import { PbTodayTodos } from "@/components/advisory/PbTodayTodos";
import ConsultationScheduleModal from "@/components/advisory/ConsultationScheduleModal";
import ExtraEventModal from "@/components/advisory/ExtraEventModal";
import PbCustomerConsultationPanels from "@/components/PbCustomerConsultationPanels";
import { buildClientBookRow } from "@/lib/advisory/book";
import { listBookHoldings, enrichBookHoldingsWithQuotes } from "@/lib/advisory/holdingsStore";
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
      const holdingsRaw = await listBookHoldings(mine.map((c) => c.id));
      const { holdings, fxUsdKrw } = await enrichBookHoldingsWithQuotes(holdingsRaw);
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

      const rows = mine.map((c) =>
        buildClientBookRow(c, holdings, cons, asOf, heritageInputs.get(c.id), fxUsdKrw),
      );
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

      <PbCustomerConsultationPanels
        pbId={pbId}
        clients={myClients}
        consultations={consultations}
        onConsultationsChange={setConsultations}
        onRequestReload={load}
      />

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
