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
import PBManageModal from "@/components/PBManageModal";
import ClientTable from "@/components/ClientTable";
import ClientForm, { type ClientFormValue } from "@/components/ClientForm";
import ViewToggle from "@/components/ViewToggle";
import ConfirmModal from "@/components/ConfirmModal";
import { LoadingView, ErrorView, EmptyView } from "@/components/StateViews";
import { formatKRWShort } from "@/lib/format";

type ViewMode = "pb" | "client";

type MarketTicker = { label: string; sub: string; value: string; change: string; up: boolean };
type EtfItem = { code: string; name: string; price: number; changeRate: string; up: boolean; flat: boolean };

// 로딩 중·실패 시 보여줄 폴백(예시) 값
const DUMMY_MARKET: MarketTicker[] = [
  { label: "코스피", sub: "KOSPI", value: "2,545.98", change: "+0.87%", up: true },
  { label: "S&P 500", sub: "S&P 500", value: "5,602.23", change: "+1.24%", up: true },
  { label: "원/달러", sub: "USD/KRW", value: "1,372.50", change: "-0.34%", up: false },
  { label: "미국 국채 10Y", sub: "US 10Y", value: "4.46%", change: "-0.03%p", up: false },
  { label: "한국 국채 3Y", sub: "국고채 3년", value: "3.21%", change: "+0.02%p", up: true },
];

export default function HomePage() {
  const [view, setView] = useState<ViewMode>("pb");
  const [pbs, setPbs] = useState<PB[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [status, setStatus] = useState<"loading" | "error" | "ready">("loading");

  // PB 관리 모달
  const [pbManageOpen, setPbManageOpen] = useState(false);

  // 고객 폼/삭제 상태
  const [clientFormOpen, setClientFormOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [deleteClientTarget, setDeleteClientTarget] = useState<Client | null>(null);

  // 증시·금리 티커 (실시간 /api/market, 실패 시 더미 폴백)
  const [market, setMarket] = useState<MarketTicker[]>(DUMMY_MARKET);
  const [marketLive, setMarketLive] = useState(false);
  // 삼성자산운용 KODEX 인기 ETF (/api/etf)
  const [etfs, setEtfs] = useState<EtfItem[]>([]);
  const [rightTab, setRightTab] = useState<"market" | "etf">("market");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/market", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled || !d?.ok || !Array.isArray(d.items) || d.items.length === 0) return;
        setMarket(d.items);
        setMarketLive(true);
      })
      .catch(() => {});
    fetch("/api/etf", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled || !d?.ok || !Array.isArray(d.items)) return;
        setEtfs(d.items);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

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

  // 히어로용 집계
  const totalAum = clients.reduce((sum, c) => sum + (c.assetSize || 0), 0);

  const handleCreatePb = async (name: string) => {
    await createPb(name);
    await load();
  };
  const handleRenamePb = async (id: string, name: string) => {
    await updatePb(id, name);
    await load();
  };
  const handleDeletePb = async (id: string) => {
    await deletePb(id);
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
      {/* 히어로 — 바이낸스식 2단 (좌: 헤드라인+CTA / 우: 시세 패널) */}
      <div className="mb-6 grid grid-cols-1 items-start gap-6 lg:grid-cols-[1.25fr_1fr]">
        {/* 좌 */}
        <div>
          <p className="flex items-center gap-2 text-xs font-semibold tracking-widest text-gold-400">
            <span className="h-px w-6 bg-gold-400" />
            SAMSUNG SECURITIES · PRIVATE BANKING
          </p>
          <h1 className="mt-2 text-4xl font-black leading-[1.02] tracking-tight text-fg sm:text-5xl">
            {formatKRWShort(totalAum)}
          </h1>
          <p className="mt-1 text-lg font-bold text-fg-muted">관리 자산 규모</p>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-fg-muted">
            삼성증권의 노하우로 <b className="text-fg">고객의 상황에 맞춰 최적의 솔루션</b>을 제공합니다.
          </p>

          {/* 스탯 칩 */}
          <div className="mt-4 flex flex-wrap gap-3">
            <div className="rounded-xl border border-border bg-surface px-5 py-2.5">
              <p className="text-2xl font-black text-gold-400">{clients.length}</p>
              <p className="text-xs text-fg-muted">관리 고객</p>
            </div>
            <div className="rounded-xl border border-border bg-surface px-5 py-2.5">
              <p className="text-2xl font-black text-gold-400">{pbs.length}</p>
              <p className="text-xs text-fg-muted">담당 PB</p>
            </div>
          </div>

          {/* CTA */}
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              className="btn-gold px-6 py-2.5"
              onClick={() => {
                setEditingClient(null);
                setClientFormOpen(true);
              }}
            >
              + 고객 추가
            </button>
            <button className="btn-outline px-6 py-2.5" onClick={() => setPbManageOpen(true)}>
              PB 관리
            </button>
          </div>
          <p className="mt-4 text-[11px] text-fg-muted/70">
            ※ 본 도구의 분석·포트폴리오 결과는 참고용이며 투자 권유가 아닙니다.
          </p>
        </div>

        {/* 우 — 시세 패널 (증시·금리 / KODEX ETF 탭) */}
        <div className="rounded-2xl border border-border bg-surface p-4 shadow-card">
          {/* 탭 헤더 */}
          <div className="mb-3 flex items-center justify-between">
            <div className="flex gap-1">
              <button
                onClick={() => setRightTab("market")}
                className={`rounded-md px-3 py-1.5 text-sm font-bold transition-colors ${
                  rightTab === "market"
                    ? "bg-surface-2 text-fg"
                    : "text-fg-muted hover:text-fg"
                }`}
              >
                증시 · 금리
              </button>
              <button
                onClick={() => setRightTab("etf")}
                className={`rounded-md px-3 py-1.5 text-sm font-bold transition-colors ${
                  rightTab === "etf" ? "bg-surface-2 text-fg" : "text-fg-muted hover:text-fg"
                }`}
              >
                KODEX ETF
              </button>
            </div>
            {rightTab === "market" ? (
              <span
                className={`flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-medium ${
                  marketLive ? "bg-green-500/15 text-green-500" : "bg-surface-2 text-fg-muted"
                }`}
              >
                {marketLive ? (
                  <>
                    <span className="h-1.5 w-1.5 rounded-full bg-green-500" /> 실시간
                  </>
                ) : (
                  "예시"
                )}
              </span>
            ) : (
              <span className="rounded-md bg-surface-2 px-2 py-0.5 text-[10px] font-medium text-fg-muted">
                순자산 상위
              </span>
            )}
          </div>

          {/* 증시·금리 */}
          {rightTab === "market" && (
            <div className="space-y-0.5">
              {market.map((m) => (
                <div
                  key={m.label}
                  className="flex items-center justify-between rounded-lg px-2 py-2 transition-colors hover:bg-surface-2"
                >
                  <div>
                    <p className="text-sm font-semibold text-fg">{m.label}</p>
                    <p className="text-[11px] text-fg-muted">{m.sub}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-fg">{m.value}</p>
                    <p className={`text-[11px] font-medium ${m.up ? "text-green-500" : "text-red-500"}`}>
                      {m.change}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* KODEX ETF */}
          {rightTab === "etf" &&
            (etfs.length === 0 ? (
              <p className="py-8 text-center text-sm text-fg-muted">불러오는 중…</p>
            ) : (
              <div className="space-y-0.5">
                {etfs.map((e) => (
                  <a
                    key={e.code}
                    href={`https://finance.naver.com/item/main.naver?code=${e.code}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center justify-between gap-2 rounded-lg px-2 py-2 transition-colors hover:bg-surface-2"
                  >
                    <p className="min-w-0 truncate text-sm font-semibold text-fg">{e.name}</p>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-semibold text-fg">{e.price.toLocaleString()}원</p>
                      <p
                        className={`text-[11px] font-medium ${
                          e.flat ? "text-fg-muted" : e.up ? "text-green-500" : "text-red-500"
                        }`}
                      >
                        {e.changeRate}
                      </p>
                    </div>
                  </a>
                ))}
              </div>
            ))}
        </div>
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
            <button className="btn-gold text-sm" onClick={() => setPbManageOpen(true)}>
              PB 정보 수정
            </button>
          </div>
          {pbs.length === 0 ? (
            <EmptyView
              title="아직 등록된 PB가 없어요"
              hint="오른쪽 위 'PB 정보 수정' 버튼에서 PB를 추가하세요."
              action={
                <button className="btn-gold text-sm" onClick={() => setPbManageOpen(true)}>
                  PB 정보 수정
                </button>
              }
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {pbs.map((pb) => (
                <PBCard key={pb.id} pb={pb} clientCount={clientCount(pb.id)} />
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

      <PBManageModal
        open={pbManageOpen}
        pbs={pbs}
        clientCountOf={clientCount}
        onCreate={handleCreatePb}
        onRename={handleRenamePb}
        onDelete={handleDeletePb}
        onClose={() => setPbManageOpen(false)}
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
