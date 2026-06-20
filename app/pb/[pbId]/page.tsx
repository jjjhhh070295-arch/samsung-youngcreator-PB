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
} from "@/lib/store";
import PBDashboard from "@/components/PBDashboard";
import ClientTable from "@/components/ClientTable";
import ClientForm, { type ClientFormValue } from "@/components/ClientForm";
import PBForm from "@/components/PBForm";
import ConfirmModal from "@/components/ConfirmModal";
import { LoadingView, ErrorView, EmptyView } from "@/components/StateViews";
import HouseholdModule from "@/components/HouseholdModule";

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
      setStatus("ready");
    } catch (e) {
      console.error(e);
      setStatus("error");
    }
  }, [pbId]);

  useEffect(() => {
    load();
  }, [load]);

  const myClients = allClients.filter((c) => c.assignedPbId === pbId);
  const myClientIds = new Set(myClients.map((c) => c.id));
  const myConsultations = consultations.filter((c) => myClientIds.has(c.clientId));

  const submitClient = async (v: ClientFormValue) => {
    await createClient(v);
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
    <div className="space-y-6 px-6 py-6">
      {/* 헤더 */}
      <div>
        <Link href="/" className="text-xs text-fg-muted hover:text-fg">
          ← 대시보드
        </Link>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gold-400/15 text-sm font-bold text-gold-400">
              {pb.name?.[0] ?? "?"}
            </span>
            <h1 className="text-xl font-bold text-fg">{pb.name}</h1>
          </div>
          <div className="flex gap-2">
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
      </div>

      {/* 대시보드 */}
      <PBDashboard clients={myClients} consultations={myConsultations} />

      {/* 담당 고객 */}
      <div>
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-fg-muted">담당 고객</h2>
          <button className="btn-gold text-sm" onClick={() => setClientFormOpen(true)}>
            + 고객 추가
          </button>
        </div>
        <p className="mb-3 text-xs text-fg-muted">
          이름·식별코드로 검색할 수 있습니다. 고객 행의{" "}
          <b className="text-gold-600 dark:text-gold-300">[상담 →]</b> 버튼으로
          <b> 조회</b>하면, 그 안에서 상담 진행과 고객 정보 <b>수정·삭제</b>를 할 수 있습니다.
        </p>
        {myClients.length === 0 ? (
          <EmptyView
            title="아직 담당 고객이 없어요"
            hint="'고객 추가' 버튼으로 새 고객을 등록하세요."
          />
        ) : (
          <ClientTable
            clients={myClients}
            pbs={pbs}
            showPbColumn={false}
            searchable
            rowHref={(c) => `/pb/${pbId}/${c.id}`}
          />
        )}
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
    </div>
  );
}
