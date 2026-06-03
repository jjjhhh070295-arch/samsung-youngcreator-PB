"use client";

import { useCallback, useEffect, useState } from "react";
import type { PB, Client } from "@/lib/types";
import {
  listPbs,
  listClients,
  createPb,
  updatePb,
  deletePb,
  createClient,
  updateClient,
  deleteClient,
  nextClientCode,
  usingLocalFallback,
} from "@/lib/store";
import PBCard from "@/components/PBCard";
import PBForm from "@/components/PBForm";
import ClientTable from "@/components/ClientTable";
import ClientForm, { type ClientFormValue } from "@/components/ClientForm";
import ViewToggle from "@/components/ViewToggle";
import ConfirmModal from "@/components/ConfirmModal";
import { LoadingView, ErrorView, EmptyView } from "@/components/StateViews";

type ViewMode = "pb" | "client";

export default function HomePage() {
  const [view, setView] = useState<ViewMode>("pb");
  const [pbs, setPbs] = useState<PB[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [status, setStatus] = useState<"loading" | "error" | "ready">("loading");

  // PB 폼/삭제 상태
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<PB | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PB | null>(null);

  // 고객 폼/삭제 상태
  const [clientFormOpen, setClientFormOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [deleteClientTarget, setDeleteClientTarget] = useState<Client | null>(null);

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const [p, c] = await Promise.all([listPbs(), listClients()]);
      setPbs(p);
      setClients(c);
      setStatus("ready");
    } catch (e) {
      console.error(e);
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const clientCount = (pbId: string) =>
    clients.filter((c) => c.assignedPbId === pbId).length;

  const submitPb = async (name: string) => {
    if (editing) await updatePb(editing.id, name);
    else await createPb(name);
    await load();
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    await deletePb(deleteTarget.id);
    setDeleteTarget(null);
    await load();
  };

  const submitClient = async (v: ClientFormValue) => {
    if (editingClient) {
      await updateClient(editingClient.id, {
        code: v.code,
        clientType: v.clientType,
        name: v.name,
        birthDate: v.birthDate,
        assignedPbId: v.assignedPbId,
        assetSize: v.assetSize,
      });
    } else {
      await createClient(v);
    }
    await load();
  };

  const confirmDeleteClient = async () => {
    if (!deleteClientTarget) return;
    await deleteClient(deleteClientTarget.id);
    setDeleteClientTarget(null);
    await load();
  };

  return (
    <div>
      {/* 히어로 배너 */}
      <div className="mb-6 overflow-hidden rounded-2xl bg-gradient-to-br from-navy-900 via-navy-800 to-navy-700 p-6 text-white shadow-card sm:p-8">
        <p className="flex items-center gap-2 text-xs font-medium text-gold-300">
          <span className="h-px w-6 bg-gold-400" />
          SAMSUNG SECURITIES · PRIVATE BANKING
        </p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">
          삼성증권 PB센터
        </h1>
        <p className="mt-2 max-w-xl text-sm text-white/70">
          고객 상담을 <b className="text-gold-300">RRTTLLU 7요인</b>으로 구조화해
          투자정책서(IPS)로 정리하고, 상담 이력·성향 변화·운용자산을 한곳에서 관리합니다.
        </p>
        <p className="mt-3 text-[11px] text-white/40">
          ※ 본 도구의 분석·포트폴리오 결과는 참고용이며 투자 권유가 아닙니다.
        </p>
      </div>

      {/* 보기 토글 */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-fg">상담 관리 대시보드</h2>
          <p className="text-sm text-fg-muted">PB·고객을 선택해 상담을 진행하세요.</p>
        </div>
        <div className="flex items-center gap-2">
          <ViewToggle
            options={[
              { value: "pb", label: "PB 기준" },
              { value: "client", label: "고객 기준" },
            ]}
            value={view}
            onChange={setView}
          />
        </div>
      </div>

      {usingLocalFallback && (
        <div className="mb-4 rounded-lg border border-gold-300 bg-gold-50 px-4 py-2.5 text-xs text-gold-800 dark:border-gold-700 dark:bg-gold-900/30 dark:text-gold-200">
          ⚠️ Supabase 키가 없어 <b>로컬(브라우저) 모드</b>로 동작 중입니다. 데이터는
          이 브라우저에만 저장되고 팀원과 공유되지 않습니다. `.env.local`에 Supabase
          키를 넣으면 공유 DB로 전환됩니다.
        </div>
      )}

      {status === "loading" && <LoadingView />}
      {status === "error" && <ErrorView onRetry={load} />}

      {status === "ready" && view === "pb" && (
        <>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-fg-muted">PB 폴더</h2>
            <button
              className="btn-gold text-sm"
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              + PB 추가
            </button>
          </div>
          {pbs.length === 0 ? (
            <EmptyView
              title="아직 등록된 PB가 없어요"
              hint="오른쪽 위 '+ PB 추가' 버튼으로 PB를 등록하세요."
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {pbs.map((pb) => (
                <PBCard
                  key={pb.id}
                  pb={pb}
                  clientCount={clientCount(pb.id)}
                  onEdit={() => {
                    setEditing(pb);
                    setFormOpen(true);
                  }}
                  onDelete={() => setDeleteTarget(pb)}
                />
              ))}
            </div>
          )}
        </>
      )}

      {status === "ready" && view === "client" && (
        <>
          <div className="mb-1 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-fg-muted">전체 고객</h2>
            <button
              className="btn-gold text-sm"
              onClick={() => {
                setEditingClient(null);
                setClientFormOpen(true);
              }}
            >
              + 고객 추가
            </button>
          </div>
          <p className="mb-3 text-xs text-fg-muted">
            고객을 먼저 추가한 뒤, 행의 <b className="text-gold-600 dark:text-gold-300">[수정]</b>에서
            담당 PB를 연결할 수 있습니다. (담당 PB는 비워둬도 됩니다)
          </p>
          {clients.length === 0 ? (
            <EmptyView
              title="아직 등록된 고객이 없어요"
              hint="오른쪽 위 '+ 고객 추가' 버튼으로 고객을 등록하세요. 담당 PB는 나중에 연결할 수 있어요."
              action={
                <button
                  className="btn-gold text-sm"
                  onClick={() => {
                    setEditingClient(null);
                    setClientFormOpen(true);
                  }}
                >
                  + 고객 추가
                </button>
              }
            />
          ) : (
            <ClientTable
              clients={clients}
              pbs={pbs}
              searchable
              rowHref={(c) =>
                c.assignedPbId ? `/pb/${c.assignedPbId}/${c.id}` : `/client/${c.id}`
              }
              onEdit={(c) => {
                setEditingClient(c);
                setClientFormOpen(true);
              }}
              onDelete={(c) => setDeleteClientTarget(c)}
            />
          )}
        </>
      )}

      <PBForm
        open={formOpen}
        initial={editing}
        onSubmit={submitPb}
        onClose={() => setFormOpen(false)}
      />

      <ConfirmModal
        open={!!deleteTarget}
        title="PB를 삭제할까요?"
        danger
        confirmLabel="삭제"
        description={
          <>
            <b>{deleteTarget?.name}</b> ({deleteTarget?.code})를 삭제합니다.
            <br />
            담당 고객 {deleteTarget ? clientCount(deleteTarget.id) : 0}명은 삭제되지 않고
            <b> 담당 PB가 미지정</b>으로 바뀝니다.
          </>
        }
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      <ClientForm
        open={clientFormOpen}
        initial={editingClient}
        pbs={pbs}
        suggestedCode={nextClientCode(clients)}
        onSubmit={submitClient}
        onClose={() => setClientFormOpen(false)}
      />

      <ConfirmModal
        open={!!deleteClientTarget}
        title="고객을 삭제할까요?"
        danger
        confirmLabel="삭제"
        description={
          <>
            <b>{deleteClientTarget?.name}</b> ({deleteClientTarget?.code})와 관련 상담
            이력이 <b>모두 삭제</b>됩니다. 되돌릴 수 없습니다.
          </>
        }
        onConfirm={confirmDeleteClient}
        onCancel={() => setDeleteClientTarget(null)}
      />
    </div>
  );
}
