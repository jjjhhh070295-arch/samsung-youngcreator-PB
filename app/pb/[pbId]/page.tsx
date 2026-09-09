"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  getClient,
  updateClient,
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
import ClientConsultationLog from "@/components/ClientConsultationLog";
import { buildUnapprovalPatch, isLevelApproved } from "@/lib/advisory/approvalTransition";
import { buildClientBookRow } from "@/lib/advisory/book";
import { calcAumWeightedReturn, type AumWeightedReturnResult } from "@/lib/advisory/portfolioReturn";
import { listBookHoldings, enrichBookHoldingsWithQuotes } from "@/lib/advisory/holdingsStore";
import { resolveHeritageInputsBulk } from "@/lib/heritage";
import { resolveAssetBreakdownBulk } from "@/lib/assets";

const EMPTY_AUM_WEIGHTED_RETURN: AumWeightedReturnResult = {
  status: "unavailable",
  returnPct: null,
  totalPnlKrw: null,
  totalAumKrw: 0,
  coveredAumKrw: 0,
  coveragePct: 0,
  missingClientCount: 0,
  note: "평가 가능한 운용자산 없음",
};

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
  const [aumWeightedReturn, setAumWeightedReturn] = useState<AumWeightedReturnResult>(EMPTY_AUM_WEIGHTED_RETURN);
  const loadSeqRef = useRef(0);

  const refreshSchedules = useCallback(() => {
    setScheduleRefreshKey((key) => key + 1);
  }, []);

  const load = useCallback(async () => {
    const loadSeq = ++loadSeqRef.current;
    setStatus("loading");
    try {
      const [allPbs, clients, cons] = await Promise.all([
        listPbs(),
        listClients(),
        listAllConsultations(),
      ]);
      const mine = clients.filter((c) => c.assignedPbId === pbId);
      const asOf = new Date().toISOString();
      const holdingsRaw = await listBookHoldings(mine.map((c) => c.id));
      const { holdings, fxUsdKrw } = await enrichBookHoldingsWithQuotes(holdingsRaw);
      const assetBreakdownMap = await resolveAssetBreakdownBulk(mine.map((c) => c.id), { clients, holdings: holdingsRaw });

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
      const rowByClientId = new Map(rows.map((row) => [row.clientId, row] as const));
      const nextInvestableAum = Array.from(assetBreakdownMap.values()).reduce((sum, breakdown) => sum + breakdown.investableKrw, 0);
      const nextAumWeightedReturn = calcAumWeightedReturn(
        mine.map((client) => {
          const row = rowByClientId.get(client.id);
          const breakdown = assetBreakdownMap.get(client.id);
          return {
            clientId: client.id,
            aumKrw: breakdown?.investableKrw ?? 0,
            returnStatus: row?.returnStatus ?? null,
            returnPct: row?.totalReturnPct ?? null,
          };
        }),
      );
      if (loadSeq !== loadSeqRef.current) return;

      setPbs(allPbs);
      setPb(allPbs.find((p) => p.id === pbId) ?? null);
      setAllClients(clients);
      setConsultations(cons);
      setBookRows(rows);
      setInvestableAum(nextInvestableAum);
      setAumWeightedReturn(nextAumWeightedReturn);
      setStatus("ready");
    } catch (e) {
      if (loadSeq !== loadSeqRef.current) return;
      console.error(e);
      setInvestableAum(0);
      setAumWeightedReturn(EMPTY_AUM_WEIGHTED_RETURN);
      setStatus("error");
    }
  }, [pbId]);

  useEffect(() => {
    load();
  }, [load]);

  // 상담 저장 후 처리. 고객 상세와 동작을 맞춘다.
  //
  // ConsultationModal 은 저장 시 updateClient(client.id, { ips, consultationNotes }) 로
  // 7요인을 덮어쓴다. 그 두 값은 기본정보 승인 해시 payload 에 들어 있어(approvalSnapshots
  // 의 buildBasicApprovalPayload) 승인이 풀려야 맞다. 고객 상세에서는 load() 가 status 를
  // loading→ready 로 되돌리면서 스테일 승인 검사 effect 가 다시 돌아 자동으로 해제되는데,
  // PB Home 에는 그 effect 가 없어 여기서 명시적으로 처리한다. 같은 화면에서 같은 모달을
  // 썼는데 한쪽만 승인이 남아 있으면 안 된다.
  const handleConsultationSaved = useCallback(async (clientId: string) => {
    try {
      const fresh = await getClient(clientId);
      if (fresh && isLevelApproved(fresh, "basic")) {
        await updateClient(clientId, buildUnapprovalPatch(fresh, "basic"));
      }
    } catch (e) {
      // 해제 실패를 조용히 넘기지 않는다 — 승인이 남은 채로 7요인만 바뀌면 화면과 승인
      // 상태가 어긋난다. 다만 재조회는 계속 진행해 방금 저장한 상담이 보이게 한다.
      console.error("[PB Home] 상담 저장 후 기본정보 승인 해제 실패", e);
    }
    await load();
  }, [load]);

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
        <PBDashboard clients={myClients} investableAum={investableAum} aumWeightedReturn={aumWeightedReturn} />
      </section>

      <PbTodayTodos pbId={pbId} refreshKey={scheduleRefreshKey} />

      <BookDashboard pbId={pbId} rows={bookRows} clients={myClients} onConsultationSaved={handleConsultationSaved} />

      {/* 고객 구성(선택) + 선택 고객 상담 이력. 예전에는 정적 "고객 구성" 카드와
          "최근 상담 고객" 목록이었는데, 담당 고객 상담이 0건이면 양쪽 다 알맹이가 없어
          상담 기능이 없는 것처럼 보였다. 고객을 고르고 그 고객의 이력을 보는 흐름으로
          바꾸고, 0건일 때도 섹션과 다음 행동(상담 시작)을 남긴다. */}
      <ClientConsultationLog
        pbId={pbId}
        clients={myClients}
        consultations={myConsultations}
        onConsultationSaved={handleConsultationSaved}
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
